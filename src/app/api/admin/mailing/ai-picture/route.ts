// src/app/api/admin/mailing/ai-picture/route.ts
// Makes the post maker design for a picture an email draft asked for: a starter in the chosen
// look with AI words from the email's brief, or from the part of the email it sits above. The
// editor then measures, draws and stores it.

import { parseObjectId } from "@/features/business/lib/validation";
import {
  isPictureKind,
  MAX_DRAFT_PICTURES,
  pictureBriefOf,
  POST_SOURCE_MAX,
  type PictureKind,
} from "@/features/mailing/lib/ai-draft";
import { draftRoom, fillDraft, POST_DRAFT_KINDS } from "@/features/social-design/lib/ai-draft";
import { toDesignRow } from "@/features/social-design/lib/design-row";
import { goneOut } from "@/features/social-design/lib/gone-out.server";
import { loadBoundValues } from "@/features/social-design/lib/load-bound";
import { snapshotBeforeSave } from "@/features/social-design/lib/versions";
import { writeDesignWords } from "@/features/social-design/lib/write-words";
import { emailPictureStarter } from "@/features/social-design/templates/starters";
import { aiRateLimitResponse } from "@/shared/lib/ai-rate-limit";
import { aiConfigured, isAiRateLimitError } from "@/shared/lib/ai/json-completion";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { canUploadImages } from "@/shared/lib/image-upload";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Prisma, SocialDesign } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

const MAX_NAME = 80;

/** Longest part of an email a picture's words are written from. */
const MAX_PART = 1000;

/** The design an email's drafts draw in, and the updatedAt it was read at. */
interface Redraw {
  id: string;
  updatedAt: Date;
}

/** What a picture's design is written with. */
interface DesignData {
  name: string;
  kind: string;
  doc: Prisma.InputJsonValue;
}

/**
 * The design an email's drafted picture in this slot is drawn in: the newest made for it that
 * only this email shows. One made for a post, or with a picture in a post or another email
 * (drafts too), is passed over, so a new design takes its place and it stays as it is.
 * @param campaignId - The email.
 * @param slot - Which of the draft's new pictures it is.
 * @returns The design free to draw over, or null to make a new one.
 */
async function emailDesign(campaignId: string, slot: number): Promise<Redraw | null> {
  // A design drawn before slots were kept counts as the first.
  const designs = await prisma.socialDesign.findMany({
    where: {
      campaignId,
      isTemplate: false,
      ...(slot === 0
        ? { OR: [{ campaignSlot: 0 }, { campaignSlot: null }, { campaignSlot: { isSet: false } }] }
        : { campaignSlot: slot }),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, updatedAt: true, postId: true, renders: true },
  });
  const used = await goneOut(designs, { anyState: true, exceptEmail: campaignId });
  const free = designs.find((d) => !d.postId && !used.has(d.id));
  return free ? { id: free.id, updatedAt: free.updatedAt } : null;
}

/**
 * Writes a redraft over one of the email's designs, so Post maker keeps one per picture however
 * often the email is drafted; the last version goes in the design's History.
 * @param redraw - The design, and the updatedAt it was read at.
 * @param data - The new name, kind and doc.
 * @returns The rewritten design, or null to make a new one.
 */
async function drawOver(redraw: Redraw, data: DesignData): Promise<SocialDesign | null> {
  const where: Prisma.SocialDesignWhereInput = { id: redraw.id, updatedAt: redraw.updatedAt };
  const before = await prisma.socialDesign.findFirst({
    where,
    select: { name: true, doc: true, renders: true },
  });
  if (!before) return null;
  // Matched on updatedAt again, so a Post maker save in between isn't overwritten.
  const { count } = await prisma.socialDesign.updateMany({ where, data });
  if (count === 0) return null;
  // The last try goes in the design's History, in case it read better.
  await snapshotBeforeSave(redraw.id, true, before).catch((error: unknown) =>
    console.error(`[mailing/ai-picture] ${redraw.id} version copy failed:`, error),
  );
  return prisma.socialDesign.findUnique({ where: { id: redraw.id } });
}

/**
 * What a look's words are for. Scam and thanks have no post kind of their own, so they get
 * their own lines.
 * @param kind - The look.
 * @returns The guide line.
 */
function guideFor(kind: PictureKind): string {
  if (kind === "scam") {
    return 'A warning about a scam going around. The headline names the scam plainly ("Fake parcel texts"); the ticked points are the signs to watch for.';
  }
  if (kind === "thanks") {
    return 'A thank-you to past customers. INVARIANT: the headline starts with "Thank you" ("Thank you for choosing me"). The short line carries the one thing the brief asks of them, if it asks anything (like a Google review); other news in the brief stays in the email.';
  }
  return POST_DRAFT_KINDS.find((k) => k.key === kind)!.guide;
}

/**
 * POST /api/admin/mailing/ai-picture
 * Body: `{ brief, kind, name, campaignId, part, slot }`: the email's brief, a picture look, the
 * design's name, the email, the paragraph a picture partway down sits above ("" for the top
 * one), and which of the draft's new pictures this is, from 0. The email's design for that
 * slot is drawn over when there is one free.
 * @param request - Incoming request.
 * @returns JSON `{ design, template, words, bound }` (201): the stored design with its words in,
 *   the unfilled starter to measure against, the words, and live values for drawing. 503 when
 *   uploads or AI aren't set up, 429 when the AI provider is rate limited.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as {
    brief?: unknown;
    kind?: unknown;
    name?: unknown;
    campaignId?: unknown;
    part?: unknown;
    slot?: unknown;
  } | null;
  if (!body || typeof body !== "object") return errorResponse("Invalid request body", 400);

  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (!brief) return errorResponse("Say what the email is about.", 400);
  if (brief.length > POST_SOURCE_MAX) {
    return errorResponse(`Keep it to ${POST_SOURCE_MAX} characters or fewer.`, 400);
  }
  const part = typeof body.part === "string" ? pictureBriefOf(body.part) : "";
  if (part.length > MAX_PART) {
    return errorResponse(`Keep the part to ${MAX_PART} characters or fewer.`, 400);
  }
  // Left out means the first; anything that isn't a number fails the check.
  const slot = body.slot === undefined ? 0 : typeof body.slot === "number" ? body.slot : -1;
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_DRAFT_PICTURES) {
    return errorResponse("slot isn't one of the draft's pictures.", 400);
  }
  if (!isPictureKind(body.kind)) return errorResponse("kind isn't a known picture look.", 400);
  const kind = body.kind;
  const name =
    (typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "").slice(
      0,
      MAX_NAME,
    ) || "Email picture";
  const campaignId = parseObjectId(body.campaignId);

  if (!canUploadImages()) {
    return errorResponse("Pictures can't be stored until BLOB_READ_WRITE_TOKEN is set.", 503);
  }
  if (!aiConfigured()) return errorResponse("No AI API key is set.", 503);

  try {
    const starter = emailPictureStarter(kind, { bookingUrl: `${getSiteUrl()}/booking` });
    const [redraw, words, bound] = await Promise.all([
      campaignId ? emailDesign(campaignId, slot) : null,
      writeDesignWords({
        brief,
        guide: guideFor(kind),
        room: draftRoom(starter.doc),
        paidAd: false,
        review: false,
        inEmail: true,
        part,
      }),
      loadBoundValues(),
    ]);
    if (!words) return errorResponse("The picture's words came back empty.", 422);

    // Stored with the words in, so a draw that fails still leaves a design to open.
    const data: DesignData = {
      name,
      kind: starter.kind,
      doc: fillDraft(starter.doc, words).doc as unknown as Prisma.InputJsonValue,
    };
    const design =
      (redraw ? await drawOver(redraw, data) : null) ??
      (await prisma.socialDesign.create({
        data: { ...data, isTemplate: false, campaignId, campaignSlot: campaignId ? slot : null },
      }));
    return okResponse({ design: toDesignRow(design), template: starter.doc, words, bound }, 201);
  } catch (err) {
    console.error("[mailing/ai-picture] failed:", err);
    if (isAiRateLimitError(err)) return aiRateLimitResponse(err);
    return errorResponse("Couldn't make the picture just now.", 502);
  }
}
