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
  type ExistingEvent,
} from "@/lib/booking";
import { fetchAllCalendarEvents } from "@/server/google/calendar";
import { randomUUID } from "crypto";

/**
 * Request payload for booking.
 */
interface BookingRequestPayload {
  /** Date in YYYY-MM-DD format. */
  dateKey: string;
  /** Time of day preference. */
  timeOfDay: TimeOfDay;
  /** Client's name. */
  name: string;
  /** Client's email. */
  email: string;
  /** Client's phone (optional). */
  phone?: string;
  /** What they need help with. */
  notes: string;
}

/**
 * POST /api/booking/request
 * Submits a booking request for manual confirmation.
 * @param request - The incoming request.
 * @returns JSON response.
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
    let existingEvents: ExistingEvent[] = [];
    try {
      existingEvents = await fetchAllCalendarEvents(now, maxDate);
    } catch {
      existingEvents = [];
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
    // This will be updated when you confirm the exact time
    const [year, month, day] = dateKey.split("-").map(Number);
    const middleHour = timeOption
      ? Math.floor((timeOption.startHour + timeOption.endHour) / 2)
      : 12;

    // Create UTC times for the placeholder slot
    const placeholderStart = new Date(Date.UTC(year, month - 1, day, middleHour - 12, 0, 0)); // Rough UTC conversion
    const placeholderEnd = new Date(placeholderStart.getTime() + 60 * 60 * 1000); // 1 hour placeholder

    const cancelToken = randomUUID();

    // Create the booking request (status: held = pending confirmation)
    const booking = await prisma.booking.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        notes: `[${timeLabel}] ${notes.trim()}${phone ? `\nPhone: ${phone.trim()}` : ""}`,
        startUtc: placeholderStart,
        endUtc: placeholderEnd,
        status: "held", // Pending your confirmation
        cancelToken,
        bufferBeforeMin: 0,
        bufferAfterMin: BOOKING_CONFIG.bufferMin,
      },
    });

    // TODO: Send notification email to yourself about the new booking request
    // Include: name, email, phone, date, time preference, notes

    return NextResponse.json({ ok: true, bookingId: booking.id });
  } catch (error) {
    console.error("[booking/request] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to submit request. Please try again." },
      { status: 500 },
    );
  }
}
