// src/app/api/cron/publish-scheduled/route.ts
// Cron job that publishes what was scheduled: social posts and mailing-list emails whose
// time has passed, plus any run that stopped part-way (a timed-out function) after 10
// minutes. Social posts go out at any hour; inside quiet hours emails wait and the
// response reports when they end. Called externally via cron-job.org every 5 minutes.
// The atomic claims in both libraries make overlapping runs harmless: a post or campaign
// only ever goes out from one run.

import { runScheduledSends } from "@/features/mailing/lib/send";
import { runScheduledSocialPosts } from "@/features/social/lib/publish";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/publish-scheduled
 * @param request - The incoming cron request.
 * @returns JSON `{ ok, posted, heldUntil, sent }`: each social post handled, when quiet
 *   hours end (null outside them), and each campaign handled with how it went.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
    return errorResponse("Unauthorized", 401);
  }

  // Each pass is caught on its own, so a failing platform can't hold up the emails.
  let posted: Awaited<ReturnType<typeof runScheduledSocialPosts>> | null = null;
  try {
    posted = await runScheduledSocialPosts();
  } catch (error) {
    console.error("[cron/publish-scheduled] Social pass failed:", error);
  }

  try {
    const { heldUntil, results } = await runScheduledSends();
    return NextResponse.json({
      ok: posted !== null,
      posted,
      heldUntil: heldUntil?.toISOString() ?? null,
      sent: results,
    });
  } catch (error) {
    console.error("[cron/publish-scheduled] Error:", error);
    return errorResponse("Scheduled send failed.", 500);
  }
}
