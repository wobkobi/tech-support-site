// src/app/api/admin/social/inbox/suggest/route.ts
// Suggest a reply: the AI writes one for the reply box to check. Takes the thread in the body
// rather than an id, so it works for any message. Nothing is saved or sent.

import { parseReplyRequest } from "@/features/social/lib/inbox/map";
import { suggestReply } from "@/features/social/lib/inbox/reply-ai.server";
import { aiRateLimitResponse } from "@/shared/lib/ai-rate-limit";
import { aiConfigured, isAiRateLimitError } from "@/shared/lib/ai/json-completion";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/social/inbox/suggest
 * Body: a `ReplyRequest` (`platform`, `kind`, `rating`, `author`, `text`, `earlier`,
 * `postText`, `tried`), read by `parseReplyRequest`.
 * @param request - Incoming request.
 * @returns JSON `{ reply, hide }`, a 429 with a retry hint when the AI provider is rate limited,
 *   or an error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const req = parseReplyRequest(await request.json().catch(() => null));
  if ("error" in req) return errorResponse(req.error, 400);
  if (!aiConfigured()) return errorResponse("No AI API key is set.", 503);
  try {
    const suggestion = await suggestReply(req);
    if (!suggestion.reply && !suggestion.hide) {
      return errorResponse("Nothing came back. Try again.", 422);
    }
    return okResponse({ ...suggestion });
  } catch (error) {
    console.error("[social/inbox/suggest] failed:", error);
    if (isAiRateLimitError(error)) return aiRateLimitResponse(error);
    return errorResponse("Couldn't write a reply just now. Try again.", 502);
  }
}
