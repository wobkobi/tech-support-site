// src/app/api/booking/days/route.ts
/**
 * @file route.ts
 * @description API route to get available booking days (blocks calendar events + DB bookings)
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  BOOKING_CONFIG,
  buildAvailableDays,
  type ExistingBooking,
  type BookableDay,
} from "@/lib/booking";

/**
 * Response containing available days.
 */
interface AvailableDaysResponse {
  /** List of available booking days with time windows. */
  days: BookableDay[];
  /** The time zone used for slot labels. */
  timeZone: string;
}

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
    const { fetchAllCalendarEvents } = await import("@/lib/google-calendar");
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
 * Returns available booking days, blocking both calendar events and database bookings
 * @returns JSON response with available days
 */
export async function GET(): Promise<NextResponse<AvailableDaysResponse>> {
  try {
    const now = new Date();
    const maxDate = new Date(now.getTime() + BOOKING_CONFIG.maxAdvanceDays * 24 * 60 * 60 * 1000);

    // Get existing bookings from database
    const existingBookings = await prisma.booking.findMany({
      where: {
        status: { in: ["held", "confirmed"] },
        endUtc: { gte: now }, // Only future bookings matter
      },
      select: {
        id: true,
        startUtc: true,
        endUtc: true,
        bufferBeforeMin: true,
        bufferAfterMin: true,
      },
    });

    const existingForSlots: ExistingBooking[] = existingBookings.map((b) => ({
      id: b.id,
      startUtc: b.startUtc,
      endUtc: b.endUtc,
      bufferBeforeMin: b.bufferBeforeMin,
      bufferAfterMin: b.bufferAfterMin,
    }));

    console.log(`[booking/days] Found ${existingForSlots.length} database bookings`);

    // Fetch calendar events (safe - returns empty array if not available)
    const calendarEvents = await fetchCalendarEventsSafe(now, maxDate);

    const days = buildAvailableDays(existingForSlots, calendarEvents, now, BOOKING_CONFIG);

    return NextResponse.json({
      days,
      timeZone: BOOKING_CONFIG.timeZone,
    });
  } catch (error) {
    console.error("[booking/days] Error:", error);
    return NextResponse.json({ days: [], timeZone: BOOKING_CONFIG.timeZone }, { status: 500 });
  }
}
