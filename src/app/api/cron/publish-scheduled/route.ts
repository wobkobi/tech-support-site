// src/app/api/cron/publish-scheduled/route.ts
// Cron job that sends mailing-list emails whose scheduled time has passed, and picks up
// any send that stopped part-way (a timed-out function) after 10 minutes. Inside quiet
// hours it sends nothing and reports when they end. Called
// externally via cron-job.org every 5 minutes. The atomic claim in the send library
// makes overlapping runs harmless: a campaign only ever goes out from one run.

import { runScheduledSends } from "@/features/mailing/lib/send";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/publish-scheduled
 * @param request - The incoming cron request.
 * @returns JSON `{ ok, heldUntil, sent }`: when quiet hours end (null outside them) and
 *   each campaign handled with how it went.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const { heldUntil, results } = await runScheduledSends();
    return NextResponse.json({
      ok: true,
      heldUntil: heldUntil?.toISOString() ?? null,
      sent: results,
    });
  } catch (error) {
    console.error("[cron/publish-scheduled] Error:", error);
    return errorResponse("Scheduled send failed.", 500);
  }
}
