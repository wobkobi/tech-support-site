// src/app/api/admin/social/caption-ai/route.ts
// Write with AI for a post's words: new options from a brief, or a change to what's written.
// Nothing is saved; the composer puts the picked option in.

import { parseCaptionRequest } from "@/features/social/lib/caption-ai";
import { writeCaptions } from "@/features/social/lib/caption-ai.server";
import { aiRateLimitResponse } from "@/shared/lib/ai-rate-limit";
import { aiConfigured, isAiRateLimitError } from "@/shared/lib/ai/json-completion";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/social/caption-ai
 * Body: a `CaptionRequest` (`mode`, `brief`, `action`, `kind`, `length`, `hashtags`, `emoji`,
 * `ending`, `platforms`, `count`, `promoId`), read by `parseCaptionRequest`.
 * @param request - Incoming request.
 * @returns JSON `{ captions }`, a 429 with a retry hint when the AI provider is rate limited,
 *   or an error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const req = parseCaptionRequest(await request.json().catch(() => null));
  if ("error" in req) return errorResponse(req.error, 400);
  if (!aiConfigured()) return errorResponse("No AI API key is set.", 503);

  try {
    const captions = await writeCaptions(req);
    if (captions.length === 0) {
      return errorResponse("Nothing came back. Try saying a bit more.", 422);
    }
    return okResponse({ captions });
  } catch (err) {
    console.error("[social/caption-ai] failed:", err);
    if (isAiRateLimitError(err)) return aiRateLimitResponse(err);
    return errorResponse("Couldn't write that just now. Try again.", 502);
  }
}
