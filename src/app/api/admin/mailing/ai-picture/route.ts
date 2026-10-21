// src/app/api/admin/mailing/ai-picture/route.ts
// Makes the post maker design for a picture an email draft asked for: a starter in the chosen
// look with AI words from the email's brief. The editor then measures, draws and stores it.

import { BRIEF_MAX, isPictureKind, type PictureKind } from "@/features/mailing/lib/ai-draft";
import { draftRoom, fillDraft, POST_DRAFT_KINDS } from "@/features/social-design/lib/ai-draft";
import { toDesignRow } from "@/features/social-design/lib/design-row";
import { loadBoundValues } from "@/features/social-design/lib/load-bound";
import { writeDesignWords } from "@/features/social-design/lib/write-words";
import { emailPictureStarter } from "@/features/social-design/templates/starters";
import { aiRateLimitResponse } from "@/shared/lib/ai-rate-limit";
import { aiConfigured, isAiRateLimitError } from "@/shared/lib/ai/json-completion";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { canUploadImages } from "@/shared/lib/image-upload";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

const MAX_NAME = 80;

/**
 * What a look's words are for. Scam has no post kind of its own, so it gets its own line.
 * @param kind - The look.
 * @returns The guide line.
 */
function guideFor(kind: PictureKind): string {
  if (kind === "scam") {
    return 'A warning about a scam going around. The headline names the scam plainly ("Fake parcel texts"); the ticked points are the signs to watch for.';
  }
  return POST_DRAFT_KINDS.find((k) => k.key === kind)!.guide;
}

/**
 * POST /api/admin/mailing/ai-picture
 * Body: `{ brief, kind, name }`: the email's brief, a picture look and the design's name.
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
      }),
      loadBoundValues(),
    ]);
    if (!words) return errorResponse("The picture's words came back empty.", 422);

    // Stored with the words in, so a draw that fails still leaves a design to open.
    const created = await prisma.socialDesign.create({
      data: {
        name,
        kind: starter.kind,
        isTemplate: false,
        doc: fillDraft(starter.doc, words).doc as unknown as Prisma.InputJsonValue,
      },
    });
    return okResponse({ design: toDesignRow(created), template: starter.doc, words, bound }, 201);
  } catch (err) {
    console.error("[mailing/ai-picture] failed:", err);
    if (isAiRateLimitError(err)) return aiRateLimitResponse(err);
    return errorResponse("Couldn't make the picture just now.", 502);
  }
}
