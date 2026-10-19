// src/app/api/cron/publish-scheduled/route.ts
// Cron (cron-job.org, every 5 min) that publishes due social posts and emails (emails wait
// out quiet hours) and busts the promo cache at promo boundaries. Atomic claims make
// overlapping runs harmless.

import { refreshPromoCacheAtBoundary } from "@/features/business/lib/promos.server";
import { runScheduledSends } from "@/features/mailing/lib/send";
import { runScheduledSocialPosts } from "@/features/social/lib/publish";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/publish-scheduled
 * @param request - The incoming cron request.
 * @returns JSON `{ ok, promoRefreshed, posted, heldUntil, sent }`; heldUntil is when
 *   quiet hours end (null outside them).
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

  try {
    const { heldUntil, results } = await runScheduledSends();
    return NextResponse.json({
      ok: posted !== null,
      promoRefreshed,
      posted,
      heldUntil: heldUntil?.toISOString() ?? null,
      sent: results,
    });
  } catch (error) {
    console.error("[cron/publish-scheduled] Error:", error);
    return errorResponse("Scheduled send failed.", 500);
  }
}
