// src/app/api/admin/schedule/recent-events/route.ts
// Recent booking-calendar events for the calculator's "Bill a calendar event" picker.

import {
  getBookingCalendarId,
  getCachedScheduleEvents,
} from "@/features/calendar/lib/google-calendar";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NZ_TZ } from "@/shared/lib/timezone-utils";
import { NextRequest, NextResponse } from "next/server";

/** NZ-local YYYY-MM-DD, for the same-day test below. */
const NZ_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: NZ_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * GET /api/admin/schedule/recent-events - Booking-calendar events from the last 14 days to
 * the end of today (NZ), newest first, max 30. Day-rounded bounds keep the cache key stable.
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
  // Two UTC days of headroom for NZ's +12/13 offset; the NZ-day filter below excludes tomorrow.
  const to = new Date(todayStart + 2 * day);
  const todayKey = NZ_DAY.format(new Date(now));

  try {
    const bookingCalId = getBookingCalendarId();
    const all = await getCachedScheduleEvents(from.toISOString(), to.toISOString());
    const events = all
      // An all-day block (a blocked day) is never a job to bill.
      .filter((e) => e.calendarEmail === bookingCalId && !e.allDay)
      // Started, or later today (a merge candidate); never a future day.
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
        // Same-address events are one trip, so the merge suggestion pre-ticks them.
        location: e.location ?? null,
      }));
    return NextResponse.json({ ok: true, events });
  } catch (err) {
    console.error("[recent-events] failed:", err);
    return errorResponse("Could not load recent events", 502);
  }
}
