// src/app/api/admin/social/inbox/refresh/route.ts
// Check now: reads new comments and reviews straight away instead of waiting for the cron.
// Turned away within 2 minutes of the last read.

import {
  loadCommentsState,
  REFRESH_EVERY_MS,
  syncComments,
} from "@/features/social/lib/inbox/sync.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/social/inbox/refresh
 * @param request - Incoming request.
 * @returns JSON `{ result }` (messages written per app, or why its read failed), 429 when read
 *   under 2 minutes ago, or 409 while another read runs.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const now = new Date();
  try {
    const { ranAt } = await loadCommentsState();
    if (ranAt && now.getTime() - Date.parse(ranAt) < REFRESH_EVERY_MS) {
      return errorResponse("Comments were checked under 2 minutes ago. Try again shortly.", 429);
    }
    const result = await syncComments(now);
    if (!result) return errorResponse("Comments are being checked already.", 409);
    return okResponse({ result });
  } catch (error) {
    console.error("[admin/social/inbox/refresh] failed:", error);
    return errorResponse("Couldn't check for comments. Try again.", 500);
  }
}
