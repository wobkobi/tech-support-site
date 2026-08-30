// src/app/api/admin/schedule/recent-events/route.ts
/**
 * @description Admin endpoint listing recent booking-calendar events for the
 * calculator's "Bill a calendar event" picker. GET returns the last two weeks
 * up to now (future bookings are excluded - a job isn't billable until it has
 * started), newest first, so the operator can jump straight to billing a
 * just-finished job with its corrected times.
 */

import {
  getBookingCalendarId,
  getCachedScheduleEvents,
} from "@/features/calendar/lib/google-calendar";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NZ_TZ } from "@/shared/lib/timezone-utils";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/** NZ-local YYYY-MM-DD, for the same-day test below. */
const NZ_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: NZ_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * GET /api/admin/schedule/recent-events - Booking-calendar events from the
 * last 14 days through to the end of today (NZ), newest first, capped at 30.
 * Later jobs on the current day are included: they are what the calculator's
 * merge suggestion offers alongside a just-finished one, and by the time an
 * operator bills the morning they are usually done too. Anything on a future
 * day is still excluded - you bill a job after it happens, not before.
 * Day-rounded window boundaries keep the underlying schedule cache key stable
 * across requests, so repeat opens of the picker stay cache-warm.
 * @param request - Incoming Next.js request
 * @returns JSON with `{ events: [{ id, summary, start, end, location }] }`
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const todayStart = Math.floor(now / day) * day;
  const from = new Date(todayStart - 14 * day);
  // Two UTC days of headroom because NZ is UTC+12/13: at 1am NZ the current NZ day runs
  // past UTC midnight, and a one-day bound would hide that afternoon's jobs. The NZ-day
  // filter below is what excludes tomorrow; this only has to avoid losing today.
  const to = new Date(todayStart + 2 * day);
  const todayKey = NZ_DAY.format(new Date(now));

  try {
    const bookingCalId = getBookingCalendarId();
    const all = await getCachedScheduleEvents(from.toISOString(), to.toISOString());
    const events = all
      .filter((e) => e.calendarEmail === bookingCalId)
      // Started already, or still to come today - a later job on the same day is
      // a merge candidate for the one being billed. A future DAY is not.
      .filter((e) => {
        const start = new Date(e.start);
        return start.getTime() <= now || NZ_DAY.format(start) === todayKey;
      })
      .sort((a, b) => b.start.localeCompare(a.start))
      .slice(0, 30)
      .map((e) => ({
        id: e.id,
        summary: e.summary ?? "(no title)",
        start: e.start,
        end: e.end,
        // Feeds the picker's merge suggestion: two events at the same address
        // are one trip, so they are offered pre-ticked.
        location: e.location ?? null,
      }));
    return NextResponse.json({ ok: true, events });
  } catch (err) {
    console.error("[recent-events] failed:", err);
    return errorResponse("Could not load recent events", 502);
  }
}
