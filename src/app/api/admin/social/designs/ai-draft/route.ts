// src/app/api/admin/social/designs/ai-draft/route.ts
// Drafts a post maker design's words from a one-line brief for the editor; nothing is
// saved or posted. Review quotes only ever come from the brief.

import { POST_BRIEF_MAX, POST_DRAFT_KINDS, readRoom } from "@/features/social-design/lib/ai-draft";
import { writeDesignWords } from "@/features/social-design/lib/write-words";
import { aiRateLimitResponse } from "@/shared/lib/ai-rate-limit";
import { aiConfigured, isAiRateLimitError } from "@/shared/lib/ai/json-completion";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/** Why a review post with no customer words in the brief is refused. */
const NO_REVIEW_WORDS =
  "Paste the customer's review into the brief, word for word, with who left it. A review post only uses what a customer actually said.";

/**
 * POST /api/admin/social/designs/ai-draft
 * Body: `{ brief, kind, room, paidAd }`: brief up to {@link POST_BRIEF_MAX} chars, a
 * {@link POST_DRAFT_KINDS} key, `draftRoom` output, and the paid-ad switch.
 * @param request - Incoming request.
 * @returns JSON `{ draft }`, a 429 with a retry hint when the AI provider is rate limited, or an error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as {
    brief?: unknown;
    kind?: unknown;
    room?: unknown;
    paidAd?: unknown;
  } | null;
  if (!body || typeof body !== "object") return errorResponse("Invalid request body", 400);

  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  if (!brief) return errorResponse("Say what the post is about.", 400);
  if (brief.length > POST_BRIEF_MAX) {
    return errorResponse(`Keep it to ${POST_BRIEF_MAX} characters or fewer.`, 400);
  }
  const room = readRoom(body.room);
  if (!room) return errorResponse("Invalid request body", 400);
  const kind = POST_DRAFT_KINDS.find((k) => k.key === body.kind) ?? POST_DRAFT_KINDS[0]!;
  const paidAd = body.paidAd === true;

  if (!aiConfigured()) return errorResponse("No AI API key is set.", 503);

  try {
    const draft = await writeDesignWords({
      brief,
      guide: kind.guide,
      room,
      paidAd,
      review: kind.key === "review",
      inEmail: false,
    });
    // A review post needs real customer words; with none, refuse rather than invent one.
    if (kind.key === "review" && (!draft || (room.quote && !draft.quote))) {
      return errorResponse(NO_REVIEW_WORDS, 422);
    }
    if (!draft) return errorResponse("The draft came back empty. Try saying a bit more.", 422);
    return okResponse({ draft });
  } catch (err) {
    console.error("[social/designs/ai-draft] failed:", err);
    if (isAiRateLimitError(err)) return aiRateLimitResponse(err);
    return errorResponse("Couldn't write a draft just now. Try again.", 502);
  }
}
