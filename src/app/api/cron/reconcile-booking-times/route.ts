// src/app/api/cron/reconcile-booking-times/route.ts
// Cron (every 30 min, see docs/CRON.md) that pulls booking times back from Google Calendar
// and flags rows whose event is gone. Runs ahead of the reminder cron so reminders see
// current times, and clears reminder stamps that don't match a moved booking. Also retries
// the booking-event deletes Google refused earlier.

import { retryPendingCalendarDeletes } from "@/features/calendar/lib/pending-calendar-deletes";
import { reconcileBookingTimes } from "@/features/calendar/lib/reconcile-booking-times";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// The query has no upper bound, so a week back covers post-job corrections; the
// 60-day default is for the manual sweep.
const CRON_SINCE_DAYS = 7;

/**
 * GET /api/cron/reconcile-booking-times
 * @param request - Incoming cron request.
 * @returns JSON `{ ok, checked, corrected, rearmed, missing, restored, unreadable, calendarDeletes }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const result = await reconcileBookingTimes({ apply: true, sinceDays: CRON_SINCE_DAYS });

    // Log corrections: each silently changes when (or whether) a reminder fires.
    for (const drift of result.drifted) {
      console.log(
        `[cron/reconcile-booking-times] ${drift.bookingId} moved to ${drift.to.startAt.toISOString()}${
          drift.skipped ? ` SKIPPED: ${drift.skipped}` : ""
        }`,
      );
    }
    for (const r of result.rearmed) {
      console.log(
        `[cron/reconcile-booking-times] ${r.bookingId} (${r.name}) re-armed: ${r.stamps.join("+")}`,
      );
    }
    for (const gone of result.missing) {
      console.warn(
        `[cron/reconcile-booking-times] ${gone.bookingId} (${gone.name}) has no calendar event - emails paused`,
      );
    }

    console.log(
      `[cron/reconcile-booking-times] done: checked=${result.checked} corrected=${result.drifted.length} rearmed=${result.rearmed.length} missing=${result.missing.length} restored=${result.restored} unreadable=${result.unreadable}`,
    );

    // Its own failure mustn't hide the reconcile result above.
    const calendarDeletes = await retryPendingCalendarDeletes().catch((err: unknown) => {
      console.error("[cron/reconcile-booking-times] Calendar delete retries failed:", err);
      return null;
    });
    if (
      calendarDeletes &&
      calendarDeletes.cleared + calendarDeletes.failed + calendarDeletes.abandoned > 0
    ) {
      console.log(
        `[cron/reconcile-booking-times] calendar deletes: cleared=${calendarDeletes.cleared} failed=${calendarDeletes.failed} abandoned=${calendarDeletes.abandoned}`,
      );
    }

    // A Google outage reads as every event unreadable, and the delete retries throwing means
    // none were tried; the 500 makes cron-job.org flag either. An odd event (an all-day edit)
    // among readable ones is unreadable on every run, so it doesn't fail the pass.
    const googleDown = result.checked > 0 && result.unreadable === result.checked;
    const failed = googleDown || calendarDeletes === null;
    return NextResponse.json(
      {
        ok: !failed,
        checked: result.checked,
        corrected: result.drifted.length,
        rearmed: result.rearmed.length,
        missing: result.missing.length,
        restored: result.restored,
        unreadable: result.unreadable,
        calendarDeletes,
      },
      { status: failed ? 500 : 200 },
    );
  } catch (error) {
    console.error("[cron/reconcile-booking-times] Error:", error);
    return errorResponse("Failed to reconcile booking times", 500);
  }
}
