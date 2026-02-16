// src/app/api/booking/request/route.ts
/**
 * @file route.ts
 * @description API route to submit a booking request.
 * Creates a pending booking that you manually confirm with the exact time.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  BOOKING_CONFIG,
  validateBookingRequest,
  TIME_OF_DAY_OPTIONS,
  type TimeOfDay,
} from "@/lib/booking";
import { fetchAllCalendarEvents, type CalendarEvent } from "@/server/google/calendar";
import { randomUUID } from "crypto";

interface BookingRequestPayload {
  dateKey: string;
  timeOfDay: TimeOfDay;
  name: string;
  email: string;
  phone?: string;
  notes: string;
}

/**
 * POST /api/booking/request
 * Submits a booking request for manual confirmation.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as BookingRequestPayload;
    const { dateKey, timeOfDay, name, email, phone, notes } = body;

    // Basic validation
    if (!name?.trim()) {
      return NextResponse.json({ ok: false, error: "Name is required." }, { status: 400 });
    }
    if (!email?.trim() || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "Valid email is required." }, { status: 400 });
    }
    if (!notes?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Please describe what you need help with." },
        { status: 400 },
      );
    }
    if (!dateKey || !timeOfDay) {
      return NextResponse.json(
        { ok: false, error: "Please select a day and time." },
        { status: 400 },
      );
    }

    const now = new Date();
    const maxDate = new Date(now.getTime() + BOOKING_CONFIG.maxAdvanceDays * 24 * 60 * 60 * 1000);

    // Fetch calendar events for validation
    let existingEvents: CalendarEvent[] = [];
    try {
      existingEvents = await fetchAllCalendarEvents(now, maxDate);
    } catch (err) {
      console.error("[booking/request] Calendar fetch failed:", err);
    }

    // Validate the request
    const validation = validateBookingRequest(
      dateKey,
      timeOfDay,
      existingEvents,
      now,
      BOOKING_CONFIG,
    );
    if (!validation.valid) {
      return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
    }

    // Get the time window label
    const timeOption = TIME_OF_DAY_OPTIONS.find((t) => t.value === timeOfDay);
    const timeLabel = timeOption?.label ?? timeOfDay;

    // Create a placeholder start/end time (middle of the time window)
    const [year, month, day] = dateKey.split("-").map(Number);
    const middleHour = timeOption
      ? Math.floor((timeOption.startHour + timeOption.endHour) / 2)
      : 12;

    // Rough UTC conversion (NZ is UTC+12/13)
    const placeholderStart = new Date(Date.UTC(year, month - 1, day, middleHour - 12, 0, 0));
    const placeholderEnd = new Date(placeholderStart.getTime() + 60 * 60 * 1000);

    const cancelToken = randomUUID();

    // Create the booking request (status: held = pending confirmation)
    const booking = await prisma.booking.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        notes: `[${timeLabel} on ${dateKey}]\n${notes.trim()}${phone ? `\nPhone: ${phone.trim()}` : ""}`,
        startUtc: placeholderStart,
        endUtc: placeholderEnd,
        status: "held",
        cancelToken,
        bufferBeforeMin: 0,
        bufferAfterMin: BOOKING_CONFIG.bufferMin,
      },
    });

    // TODO: Send notification email to yourself about the new booking request

    return NextResponse.json({ ok: true, bookingId: booking.id });
  } catch (error) {
    console.error("[booking/request] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to submit request. Please try again." },
      { status: 500 },
    );
  }
}
