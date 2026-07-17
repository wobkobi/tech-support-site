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
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/admin/schedule/recent-events - Booking-calendar events from the
 * last 14 days up to now, newest first, capped at 30. Events that have not yet
 * started are excluded - you bill a job after it happens, not before.
 * Day-rounded window boundaries keep the underlying schedule cache key stable
 * across requests, so repeat opens of the picker stay cache-warm.
 * @param request - Incoming Next.js request
 * @returns JSON with `{ events: [{ id, summary, start, end }] }`
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const day = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const todayStart = Math.floor(now / day) * day;
  const from = new Date(todayStart - 14 * day);
  // Upper bound at the start of tomorrow keeps the cache key day-stable; the
  // start-time filter below drops anything not yet started, so no future
  // booking reaches the picker.
  const to = new Date(todayStart + day);

  try {
    const bookingCalId = getBookingCalendarId();
    const all = await getCachedScheduleEvents(from.toISOString(), to.toISOString());
    const events = all
      .filter((e) => e.calendarEmail === bookingCalId)
      // Only jobs that have already started - a future booking isn't billable yet.
      .filter((e) => new Date(e.start).getTime() <= now)
      .sort((a, b) => b.start.localeCompare(a.start))
      .slice(0, 30)
      .map((e) => ({ id: e.id, summary: e.summary ?? "(no title)", start: e.start, end: e.end }));
    return NextResponse.json({ ok: true, events });
  } catch (err) {
    console.error("[recent-events] failed:", err);
    return errorResponse("Could not load recent events", 502);
  }
}
