// src/app/api/booking/slots/route.ts
/**
 * @file route.ts
 * @description API route to get available booking slots based on database and Google Calendar.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  BOOKING_CONFIG,
  buildAvailableDays,
  type ExistingBooking,
  type ExistingEvent,
} from "@/lib/booking";
import { fetchAllCalendarEvents } from "@/lib/google-calendar";

/**
 * Response containing available slots.
 */
interface AvailableSlotsResponse {
  /** List of available booking days with slots. */
  days: ReturnType<typeof buildAvailableDays>;
  /** The time zone used for slot labels. */
  timeZone: string;
}

/**
 * GET /api/booking/slots
 * Returns available booking slots based on database bookings AND Google Calendar events.
 * @returns JSON response with available days and slots.
 */
export async function GET(): Promise<NextResponse<AvailableSlotsResponse>> {
  try {
    const now = new Date();
    const maxDate = new Date(now.getTime() + BOOKING_CONFIG.maxAdvanceDays * 24 * 60 * 60 * 1000);

    // Get existing bookings from database (both held and confirmed)
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

    // Fetch Google Calendar events
    let calendarEvents: ExistingEvent[] = [];
    try {
      const rawEvents = await fetchAllCalendarEvents(now, maxDate);
      calendarEvents = rawEvents.map((e) => ({
        id: e.id,
        start: e.start,
        end: e.end,
      }));
    } catch (error) {
      console.error("[booking/slots] Failed to fetch calendar events:", error);
      // Continue without calendar events - booking system will still work with database only
    }

    const days = buildAvailableDays(existingForSlots, calendarEvents, now, BOOKING_CONFIG);

    return NextResponse.json({
      days,
      timeZone: BOOKING_CONFIG.timeZone,
    });
  } catch (error) {
    console.error("[booking/slots] Error:", error);
    return NextResponse.json({ days: [], timeZone: BOOKING_CONFIG.timeZone }, { status: 500 });
  }
}
