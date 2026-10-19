// src/app/api/cron/reconcile-booking-times/route.ts
// Cron (every 30 min, see docs/CRON.md) that pulls booking times back from Google Calendar
// and flags rows whose event is gone. Runs ahead of the reminder cron so reminders see
// current times, and clears reminder stamps that don't match a moved booking.

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
 * @returns JSON `{ ok, checked, corrected, rearmed, missing, restored, unreadable }`.
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

    return NextResponse.json({
      ok: true,
      checked: result.checked,
      corrected: result.drifted.length,
      rearmed: result.rearmed.length,
      missing: result.missing.length,
      restored: result.restored,
      unreadable: result.unreadable,
    });
  } catch (error) {
    console.error("[cron/reconcile-booking-times] Error:", error);
    return errorResponse("Failed to reconcile booking times", 500);
  }
}
