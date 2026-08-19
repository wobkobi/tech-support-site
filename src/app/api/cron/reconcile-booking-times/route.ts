// src/app/api/cron/reconcile-booking-times/route.ts
/**
 * @description Cron that pulls booking times back from Google Calendar and
 * flags rows whose event has been deleted. Called externally via cron-job.org
 * every 30 minutes. See docs/CRON.md.
 *
 * Runs ahead of the reminder and review crons on purpose: both decide when to
 * email from Booking.startAt/endAt, and both skip a booking flagged here, so a
 * time corrected in Calendar or a job called off there has to land in the row
 * first or the emails go out on stale state.
 */

import { reconcileBookingTimes } from "@/features/calendar/lib/reconcile-booking-times";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorized } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

// Short lookback: the query has no upper bound, so every future booking is
// covered regardless, and a week back reaches everything the review cron can
// still act on. The 60-day default belongs to the manual sweep, which is not
// paying an event lookup twice an hour.
const CRON_SINCE_DAYS = 7;

/**
 * GET /api/cron/reconcile-booking-times
 * @param request - Incoming cron request.
 * @returns JSON `{ ok, checked, corrected, missing, restored, unreadable }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const result = await reconcileBookingTimes({ apply: true, sinceDays: CRON_SINCE_DAYS });

    // Both corrections are worth a log line: a drifted time silently reschedules
    // when a reminder fires, and a missing event silently stops one.
    for (const drift of result.drifted) {
      console.log(
        `[cron/reconcile-booking-times] ${drift.bookingId} moved to ${drift.to.startAt.toISOString()}${
          drift.skipped ? ` SKIPPED: ${drift.skipped}` : ""
        }`,
      );
    }
    for (const gone of result.missing) {
      console.warn(
        `[cron/reconcile-booking-times] ${gone.bookingId} (${gone.name}) has no calendar event - emails paused`,
      );
    }

    console.log(
      `[cron/reconcile-booking-times] done: checked=${result.checked} corrected=${result.drifted.length} missing=${result.missing.length} restored=${result.restored} unreadable=${result.unreadable}`,
    );

    return NextResponse.json({
      ok: true,
      checked: result.checked,
      corrected: result.drifted.length,
      missing: result.missing.length,
      restored: result.restored,
      unreadable: result.unreadable,
    });
  } catch (error) {
    console.error("[cron/reconcile-booking-times] Error:", error);
    return errorResponse("Failed to reconcile booking times", 500);
  }
}
