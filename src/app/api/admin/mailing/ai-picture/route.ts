// src/app/api/admin/mailing/ai-picture/route.ts
// Makes the post maker design for a picture an email draft asked for: a starter in the chosen
// look with AI words from the email's brief. The editor then measures, draws and stores it.

import { parseObjectId } from "@/features/business/lib/validation";
import { BRIEF_MAX, isPictureKind, type PictureKind } from "@/features/mailing/lib/ai-draft";
import { draftRoom, fillDraft, POST_DRAFT_KINDS } from "@/features/social-design/lib/ai-draft";
import { toDesignRow } from "@/features/social-design/lib/design-row";
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

/** The design an email's last draft made, and the updatedAt the draft left it at. */
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
 * Reads the body's `replace`.
 * @param value - `{ id, updatedAt }` from the dialog, or anything else for none.
 * @returns The design to draw over, or null.
 */
function readRedraw(value: unknown): Redraw | null {
  if (!value || typeof value !== "object") return null;
  const r = value as { id?: unknown; updatedAt?: unknown };
  const id = parseObjectId(r.id);
  const updatedAt = typeof r.updatedAt === "string" ? new Date(r.updatedAt) : null;
  return id && updatedAt && !Number.isNaN(updatedAt.getTime()) ? { id, updatedAt } : null;
}

/**
 * Writes a redraft over the design the email's last draft made, so Post maker keeps one per
 * email instead of one per try. Only while it's as the draft left it and only this email shows
 * it: once it has been changed, posted, deleted or picked for another email, a new design keeps
 * that one as it is.
 * @param redraw - The design, and the updatedAt the draft left it at.
 * @param data - The new name, kind and doc.
 * @param campaignId - The email being drafted, or null when not sent.
 * @returns The rewritten design, or null to make a new one.
 */
async function drawOver(
  redraw: Redraw,
  data: DesignData,
  campaignId: string | null,
): Promise<SocialDesign | null> {
  const where: Prisma.SocialDesignWhereInput = {
    id: redraw.id,
    updatedAt: redraw.updatedAt,
    isTemplate: false,
    OR: [{ postId: null }, { postId: { isSet: false } }],
  };
  const before = await prisma.socialDesign.findFirst({
    where,
    select: { name: true, doc: true, renders: true },
  });
  if (!before) return null;
  const urls = before.renders.map((r) => r.url);
  if (urls.length > 0) {
    const [emails, posts] = await Promise.all([
      prisma.campaign.count({
        where: {
          ...(campaignId ? { id: { not: campaignId } } : {}),
          OR: urls.map((url) => ({ body: { contains: url } })),
        },
      }),
      prisma.socialPost.count({
        where: {
          OR: [{ imageUrl: { in: urls } }, { targets: { some: { imageUrl: { in: urls } } } }],
        },
      }),
    ]);
    if (emails + posts > 0) return null;
  }
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
 * Body: `{ brief, kind, name, replace, campaignId }`: the email's brief, a picture look, the
 * design's name, the design the email's last draft made (`{ id, updatedAt }` or null) to draw
 * over, and the email itself.
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
    replace?: unknown;
    campaignId?: unknown;
  } | null;
  if (!body || typeof body !== "object") return errorResponse("Invalid request body", 400);

  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (!brief) return errorResponse("Say what the email is about.", 400);
  if (brief.length > BRIEF_MAX) {
    return errorResponse(`Keep it to ${BRIEF_MAX} characters or fewer.`, 400);
  }
  if (!isPictureKind(body.kind)) return errorResponse("kind isn't a known picture look.", 400);
  const kind = body.kind;
  const name =
    (typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "").slice(
      0,
      MAX_NAME,
    ) || "Email picture";
  const redraw = readRedraw(body.replace);
  const campaignId = parseObjectId(body.campaignId);

  if (!canUploadImages()) {
    return errorResponse("Pictures can't be stored until BLOB_READ_WRITE_TOKEN is set.", 503);
  }
  if (!aiConfigured()) return errorResponse("No AI API key is set.", 503);

  try {
    const starter = emailPictureStarter(kind, { bookingUrl: `${getSiteUrl()}/booking` });
    const [words, bound] = await Promise.all([
      writeDesignWords({
        brief,
        guide: guideFor(kind),
        room: draftRoom(starter.doc),
        paidAd: false,
        review: false,
        inEmail: true,
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
      (redraw && (await drawOver(redraw, data, campaignId))) ??
      (await prisma.socialDesign.create({ data: { ...data, isTemplate: false } }));
    return okResponse({ design: toDesignRow(design), template: starter.doc, words, bound }, 201);
  } catch (err) {
    console.error("[mailing/ai-picture] failed:", err);
    if (isAiRateLimitError(err)) return aiRateLimitResponse(err);
    return errorResponse("Couldn't make the picture just now.", 502);
  }
}
