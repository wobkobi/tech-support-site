// src/app/api/booking/request/route.ts
/**
 * @file route.ts
 * @description API route with duration support (1hr vs 2hr jobs)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  BOOKING_CONFIG,
  DURATION_OPTIONS,
  validateBookingRequest,
  TIME_OF_DAY_OPTIONS,
  type TimeOfDay,
  type JobDuration,
  type ExistingBooking,
} from "@/lib/booking";
import { createBookingEvent, fetchAllCalendarEvents } from "@/lib/google-calendar";
import { randomUUID } from "crypto";

interface BookingRequestPayload {
  dateKey: string;
  timeOfDay: TimeOfDay;
  duration: JobDuration;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  meetingType: "in-person" | "remote";
  notes: string;
}

/**
 * POST /api/booking/request
 * Creates a booking with calendar event for the specified duration
 * @param request - Next.js request object containing booking details
 * @returns JSON response with booking ID or error message
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as BookingRequestPayload;
    const { dateKey, timeOfDay, duration, name, email, phone, address, meetingType, notes } = body;

    // Validation
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
    if (!duration) {
      return NextResponse.json(
        { ok: false, error: "Please select job duration." },
        { status: 400 },
      );
    }
    if (!meetingType) {
      return NextResponse.json(
        { ok: false, error: "Please select in-person or remote." },
        { status: 400 },
      );
    }
    if (meetingType === "in-person" && !address?.trim()) {
      return NextResponse.json(
        { ok: false, error: "Address is required for in-person appointments." },
        { status: 400 },
      );
    }

    const now = new Date();
    const maxDate = new Date(now.getTime() + BOOKING_CONFIG.maxAdvanceDays * 24 * 60 * 60 * 1000);

    // Get existing bookings
    const existingBookings = await prisma.booking.findMany({
      where: {
        status: { in: ["held", "confirmed"] },
        endUtc: { gte: now },
      },
      select: {
        id: true,
        startUtc: true,
        endUtc: true,
        bufferBeforeMin: true,
        bufferAfterMin: true,
      },
    });

    const existingForValidation: ExistingBooking[] = existingBookings.map((b) => ({
      id: b.id,
      startUtc: b.startUtc,
      endUtc: b.endUtc,
      bufferBeforeMin: b.bufferBeforeMin,
      bufferAfterMin: b.bufferAfterMin,
    }));

    // Fetch calendar events
    let calendarEvents: Array<{ id: string; start: string; end: string }> = [];
    try {
      const rawEvents = await fetchAllCalendarEvents(now, maxDate);
      calendarEvents = rawEvents.map((e) => ({
        id: e.id,
        start: e.start,
        end: e.end,
      }));
    } catch (error) {
      console.error("[booking/request] Failed to fetch calendar events:", error);
    }

    // Validate with duration
    const validation = validateBookingRequest(
      dateKey,
      timeOfDay,
      duration,
      existingForValidation,
      calendarEvents,
      now,
      BOOKING_CONFIG,
    );

    if (!validation.valid) {
      return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
    }

    // Get time details
    const slot = TIME_OF_DAY_OPTIONS.find((t) => t.value === timeOfDay);
    const durationOption = DURATION_OPTIONS.find((d) => d.value === duration);

    if (!slot || !durationOption) {
      return NextResponse.json({ ok: false, error: "Invalid time or duration" }, { status: 400 });
    }

    // Calculate start/end times
    const [year, month, day] = dateKey.split("-").map(Number);
    const startHour = slot.startHour;
    const durationMinutes = durationOption.durationMinutes;

    // NZ UTC+13
    const startUtc = new Date(Date.UTC(year, month - 1, day, startHour - 13, 0, 0));
    const endUtc = new Date(startUtc.getTime() + durationMinutes * 60 * 1000);

    const cancelToken = randomUUID();
    const reviewToken = randomUUID();

    // Build notes
    let bookingNotes = `[${slot.label} - ${durationOption.label}]\n`;
    bookingNotes += `Meeting type: ${meetingType === "in-person" ? "In-person" : "Remote"}\n`;
    if (meetingType === "in-person" && address) {
      bookingNotes += `Address: ${address.trim()}\n`;
    }
    if (phone) {
      bookingNotes += `Phone: ${phone.trim()}\n`;
    }
    bookingNotes += `\n${notes.trim()}`;

    // Create calendar event
    let calendarEventId: string | null = null;
    try {
      const calendarResult = await createBookingEvent({
        summary: `Tech Support: ${name.trim()} (${durationOption.label})`,
        description: bookingNotes,
        startUtc,
        endUtc,
        timeZone: BOOKING_CONFIG.timeZone,
        attendeeEmail: email.trim().toLowerCase(),
        attendeeName: name.trim(),
        location: meetingType === "in-person" && address ? address.trim() : undefined,
      });

      calendarEventId = calendarResult.eventId;
      console.log(`[booking/request] Created calendar event: ${calendarEventId}`);
    } catch (calendarError) {
      console.error("[booking/request] Failed to create calendar event:", calendarError);
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to create calendar event. Please try again or contact us directly.",
        },
        { status: 500 },
      );
    }

    // Create booking
    const booking = await prisma.booking.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        notes: bookingNotes,
        startUtc,
        endUtc,
        status: "confirmed",
        cancelToken,
        reviewToken,
        calendarEventId,
        bufferBeforeMin: 0,
        bufferAfterMin: BOOKING_CONFIG.bufferMin,
      },
    });

    console.log(`[booking/request] Created ${duration} booking: ${booking.id}`);

    return NextResponse.json({ ok: true, bookingId: booking.id });
  } catch (error) {
    console.error("[booking/request] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to submit request. Please try again." },
      { status: 500 },
    );
  }
}
