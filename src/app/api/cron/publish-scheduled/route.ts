// src/app/api/cron/publish-scheduled/route.ts
// Cron (cron-job.org, every 5 min) that publishes due social posts and emails (emails wait
// out quiet hours), busts the promo cache at promo boundaries, and once an hour lines up
// postings in every schedule's empty slots. Atomic claims and the fill's run lock make
// overlapping runs harmless.

import { refreshPromoCacheAtBoundary } from "@/features/business/lib/promos.server";
import { runScheduledSends } from "@/features/mailing/lib/send";
import { runScheduledSocialPosts } from "@/features/social/lib/publish";
import { fillQueues, queueFillDue, type FillResult } from "@/features/social/lib/queue-fill.server";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/publish-scheduled
 * @param request - The incoming cron request.
 * @returns JSON `{ ok, promoRefreshed, posted, filled, heldUntil, sent }`; filled is null when
 *   the hourly schedule fill wasn't due, and heldUntil is when quiet hours end (null outside them).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
    return errorResponse("Unauthorized", 401);
  }

  // Each pass is caught on its own, so a failing platform can't hold up the emails.
  let promoRefreshed = false;
  try {
    promoRefreshed = await refreshPromoCacheAtBoundary();
  } catch (error) {
    console.error("[cron/publish-scheduled] Promo boundary check failed:", error);
  }

  let posted: Awaited<ReturnType<typeof runScheduledSocialPosts>> | null = null;
  try {
    posted = await runScheduledSocialPosts();
  } catch (error) {
    console.error("[cron/publish-scheduled] Social pass failed:", error);
  }

  let filled: FillResult | null = null;
  try {
    const now = new Date();
    if (await queueFillDue(now)) {
      const { social } = await getSettings();
      filled = await fillQueues({ now, fillDays: social.schedules.fillDays });
    }
  } catch (error) {
    console.error("[cron/publish-scheduled] Schedule fill failed:", error);
  }

  try {
    const { heldUntil, results } = await runScheduledSends();
    return NextResponse.json({
      ok: posted !== null,
      promoRefreshed,
      posted,
      filled,
      heldUntil: heldUntil?.toISOString() ?? null,
      sent: results,
    });
  } catch (error) {
    console.error("[cron/publish-scheduled] Error:", error);
    return errorResponse("Scheduled send failed.", 500);
  }
}
