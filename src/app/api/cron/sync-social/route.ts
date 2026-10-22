// src/app/api/cron/sync-social/route.ts
// Cron (cron-job.org, hourly) that reads social figures: each app's account days at most every
// 6 hours, and each published post's figures at 1 hour, 1, 3, 7 and 28 days (a story's at 1, 6
// and 23 hours). A run lock makes an overlapping run or Refresh press harmless.

import { syncInsights } from "@/features/social/lib/insights/sync.server";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/sync-social
 * @param request - The incoming cron request.
 * @returns JSON `{ ok, running, days, posts, left }`; running is true when another read held the
 *   lock, so this run did nothing.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const result = await syncInsights(new Date());
    if (!result) return NextResponse.json({ ok: true, running: true });
    return NextResponse.json({ ok: true, running: false, ...result });
  } catch (error) {
    console.error("[cron/sync-social] failed:", error);
    return errorResponse("Social stats sync failed", 503);
  }
}
