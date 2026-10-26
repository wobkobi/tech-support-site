// src/app/api/cron/sync-social/route.ts
// Cron (cron-job.org, every 30 minutes) that reads new comments, reviews and messages for the
// Inbox, then social figures: each app's account days at most every 6 hours, and each published
// post's figures at 1 hour, 1, 3, 7 and 28 days (a story's at 1, 6 and 23 hours). Each read has
// its own run lock, so an overlapping run or a Refresh press is harmless.

import { syncComments } from "@/features/social/lib/inbox/sync.server";
import { syncInsights } from "@/features/social/lib/insights/sync.server";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/sync-social
 * @param request - The incoming cron request.
 * @returns JSON `{ ok, comments, running, days, posts, left }`; comments is null when another
 *   read held its lock and a message when it threw (a 500, so cron-job.org flags it), and
 *   running is true when the figures' lock was held, so neither ran.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
    return errorResponse("Unauthorized", 401);
  }
  const now = new Date();
  // A failed comments read never stops the figures.
  let comments: Awaited<ReturnType<typeof syncComments>> | string = null;
  try {
    comments = await syncComments(now);
  } catch (error) {
    console.error("[cron/sync-social] comments failed:", error);
    comments = "The comments read failed.";
  }
  const ok = typeof comments !== "string";
  const status = ok ? 200 : 500;
  try {
    const result = await syncInsights(now);
    if (!result) return NextResponse.json({ ok, comments, running: true }, { status });
    return NextResponse.json({ ok, comments, running: false, ...result }, { status });
  } catch (error) {
    console.error("[cron/sync-social] failed:", error);
    return errorResponse("Social stats sync failed", 503);
  }
}
