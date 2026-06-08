// src/app/api/booking/days/route.ts
/**
 * @file route.ts
 * @description API route to get available booking days (blocks calendar events and DB bookings).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import {
  BOOKING_CONFIG,
  buildAvailableDays,
  type ExistingBooking,
} from "@/features/booking/lib/booking";
import { getAvailabilityConfig } from "@/features/booking/lib/availability-config.server";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * Fetches calendar events if the module is available
 * @param now - Start date
 * @param maxDate - End date
 * @returns Array of calendar events or empty array if module not available
 */
async function fetchCalendarEventsSafe(
  now: Date,
  maxDate: Date,
): Promise<Array<{ id: string; start: string; end: string }>> {
  try {
    // Try to import the calendar module
    const { fetchAllCalendarEvents } = await import("@/features/calendar/lib/google-calendar");
    const rawEvents = await fetchAllCalendarEvents(now, maxDate);
    const events = rawEvents.map((e) => ({
      id: e.id,
      start: e.start,
      end: e.end,
    }));
    console.log(`[booking/days] ✅ Blocking ${events.length} calendar events`);
    return events;
  } catch (error) {
    // Log the actual error
    console.error("[booking/days] ❌ Calendar error:", error);
    console.error(
      "[booking/days] Error details:",
      error instanceof Error ? error.message : String(error),
    );
    return [];
  }
}

/**
 * GET /api/booking/days
 * Returns available booking days, blocking both calendar events and database bookings.
 * Rate-limited per IP because each call hits the DB plus the Google Calendar API.
 * @param request - Incoming request used for IP-based rate limiting.
 * @returns JSON response with available days
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "booking-days", 30, 60_000);
  if (limited) return limited;

  try {
    const now = new Date();
    const { config, acceptingBookings, closedMessage } = await getAvailabilityConfig();

    // Master switch: when paused, return no days + the operator's message.
    if (!acceptingBookings) {
      return NextResponse.json({
        days: [],
        sameDayClosed: false,
        timeZone: config.timeZone,
        acceptingBookings: false,
        closedMessage,
      });
    }

    const maxDate = new Date(now.getTime() + (config.maxAdvanceDays + 1) * 24 * 60 * 60 * 1000);

    // Get existing bookings from database
    const existingBookings = await prisma.booking.findMany({
      where: {
        status: { in: ["held", "confirmed"] },
        endAt: { gte: now }, // Only future bookings matter
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        bufferBeforeMin: true,
        bufferAfterMin: true,
      },
    });

    const existingForSlots: ExistingBooking[] = existingBookings.map((b) => ({
      id: b.id,
      startAt: b.startAt,
      endAt: b.endAt,
      bufferBeforeMin: b.bufferBeforeMin,
      bufferAfterMin: b.bufferAfterMin,
    }));

    console.log(`[booking/days] Found ${existingForSlots.length} database bookings`);

    // Fetch calendar events (safe - returns empty array if not available)
    const calendarEvents = await fetchCalendarEventsSafe(now, maxDate);

    const { days, sameDayClosed } = buildAvailableDays(
      existingForSlots,
      calendarEvents,
      now,
      config,
    );

    return NextResponse.json({
      days,
      sameDayClosed,
      timeZone: config.timeZone,
      acceptingBookings: true,
    });
  } catch (error) {
    console.error("[booking/days] Error:", error);
    return NextResponse.json({ days: [], timeZone: BOOKING_CONFIG.timeZone }, { status: 500 });
  }
}
