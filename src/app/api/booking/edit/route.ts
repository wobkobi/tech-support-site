// src/app/api/booking/edit/route.ts
/**
 * @file route.ts
 * @description API route to edit an existing booking by cancel token.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import {
  BOOKING_CONFIG,
  DURATION_OPTIONS,
  validateBookingRequest,
  validateBookingPayloadFields,
  TIME_OF_DAY_OPTIONS,
  type TimeOfDay,
  type StartMinute,
  type JobDuration,
  type ExistingBooking,
} from "@/features/booking/lib/booking";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import {
  createBookingEvent,
  deleteBookingEvent,
  fetchAllCalendarEvents,
} from "@/features/calendar/lib/google-calendar";
import { Prisma } from "@prisma/client";
import { toE164NZ } from "@/shared/lib/normalize-phone";

interface EditBookingPayload {
  cancelToken: string;
  dateKey: string;
  timeOfDay: TimeOfDay;
  startMinute?: StartMinute;
  duration: JobDuration;
  name: string;
  phone?: string;
  address?: string;
  meetingType: "in-person" | "remote";
  notes: string;
}

/**
 * POST /api/booking/edit
 * Updates an existing booking's details and reschedules the calendar event.
 * @param request - Next.js request containing edit payload.
 * @returns JSON response with ok flag or error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as EditBookingPayload;
    const {
      cancelToken,
      dateKey,
      timeOfDay,
      startMinute = 0,
      duration,
      name,
      phone,
      address,
      meetingType,
      notes,
    } = body;

    if (!cancelToken) {
      return NextResponse.json({ ok: false, error: "Missing cancel token." }, { status: 400 });
    }

    // Find booking
    const booking = await prisma.booking.findFirst({ where: { cancelToken } });
    if (!booking) {
      return NextResponse.json({ ok: false, error: "Booking not found." }, { status: 404 });
    }
    if (booking.status === "cancelled") {
      return NextResponse.json(
        { ok: false, error: "Cannot edit a cancelled booking." },
        { status: 400 },
      );
    }

    const payloadCheck = validateBookingPayloadFields(
      { name, notes, dateKey, timeOfDay, duration, meetingType, address },
      { requireEmail: false },
    );
    if (!payloadCheck.valid) {
      return NextResponse.json({ ok: false, error: payloadCheck.error }, { status: 400 });
    }

    const now = new Date();
    const maxDate = new Date(now.getTime() + BOOKING_CONFIG.maxAdvanceDays * 24 * 60 * 60 * 1000);

    // Get existing bookings, excluding the one being edited
    const existingBookings = await prisma.booking.findMany({
      where: {
        id: { not: booking.id },
        status: { in: ["held", "confirmed"] },
        endAt: { gte: now },
      },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        bufferBeforeMin: true,
        bufferAfterMin: true,
      },
    });

    const existingForValidation: ExistingBooking[] = existingBookings.map((b) => ({
      id: b.id,
      startAt: b.startAt,
      endAt: b.endAt,
      bufferBeforeMin: b.bufferBeforeMin,
      bufferAfterMin: b.bufferAfterMin,
    }));

    // Fetch calendar events, excluding the current booking's event
    let calendarEvents: Array<{ id: string; start: string; end: string }> = [];
    try {
      const rawEvents = await fetchAllCalendarEvents(now, maxDate);
      calendarEvents = rawEvents
        .filter((e) => e.id !== booking.calendarEventId)
        .map((e) => ({ id: e.id, start: e.start, end: e.end }));
    } catch (error) {
      console.error("[booking/edit] Failed to fetch calendar events:", error);
    }

    const validation = validateBookingRequest(
      dateKey,
      timeOfDay,
      startMinute,
      duration,
      existingForValidation,
      calendarEvents,
      now,
      BOOKING_CONFIG,
    );

    if (!validation.valid) {
      return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
    }

    // Calculate new times
    const slot = TIME_OF_DAY_OPTIONS.find((t) => t.value === timeOfDay);
    const durationOption = DURATION_OPTIONS.find((d) => d.value === duration);
    if (!slot || !durationOption) {
      return NextResponse.json({ ok: false, error: "Invalid time or duration." }, { status: 400 });
    }

    const [year, month, day] = dateKey.split("-").map(Number);
    const utcOffset = getPacificAucklandOffset(year, month, day);
    const startAt = new Date(
      Date.UTC(year, month - 1, day, slot.startHour - utcOffset, startMinute, 0),
    );
    const endAt = new Date(startAt.getTime() + durationOption.durationMinutes * 60 * 1000);

    // Build updated notes
    let bookingNotes = `${notes.trim()}\n\n`;
    const timeLabel =
      startMinute === 0
        ? slot.label
        : slot.label.replace(/(am|pm)$/i, `:${String(startMinute).padStart(2, "0")}$1`);
    bookingNotes += `[${timeLabel} - ${durationOption.label}]\n`;
    bookingNotes += `Meeting type: ${meetingType === "in-person" ? "In-person" : "Remote"}\n`;
    if (meetingType === "in-person" && address) {
      bookingNotes += `Address: ${address.trim()}\n`;
    }
    const phoneE164 = phone ? toE164NZ(phone) || null : null;
    if (phoneE164) {
      bookingNotes += `Phone: ${phoneE164}\n`;
    }

    // Delete old calendar event
    if (booking.calendarEventId) {
      try {
        await deleteBookingEvent({ eventId: booking.calendarEventId });
      } catch (err) {
        console.error("[booking/edit] Failed to delete old calendar event:", err);
      }
    }

    // Create new calendar event
    let calendarEventId: string | null = null;
    try {
      const cleanDurationLabel = durationOption.label
        .replace(/[()]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const summary = `Tech Support: ${name.trim()} - ${cleanDurationLabel}`;
      const calendarResult = await createBookingEvent({
        summary,
        description: bookingNotes,
        startAt,
        endAt,
        timeZone: BOOKING_CONFIG.timeZone,
        attendeeEmail: booking.email,
        attendeeName: name.trim(),
        location: meetingType === "in-person" && address ? address.trim() : undefined,
      });
      calendarEventId = calendarResult.eventId;
      console.log(`[booking/edit] Created new calendar event: ${calendarEventId}`);
    } catch (calendarError) {
      console.error("[booking/edit] Failed to create new calendar event:", calendarError);
      return NextResponse.json(
        { ok: false, error: "Failed to update calendar event. Please try again." },
        { status: 500 },
      );
    }

    // Update booking
    try {
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          name: name.trim(),
          notes: bookingNotes,
          startAt,
          endAt,
          calendarEventId,
          activeSlotKey: startAt.toISOString(),
          bufferAfterMin: BOOKING_CONFIG.bookingBufferAfterMin,
          ...(phoneE164 !== undefined ? { phone: phoneE164 } : {}),
        },
      });
      console.log(`[booking/edit] Updated booking: ${booking.id}`);
      return NextResponse.json({ ok: true });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json(
          { ok: false, error: "This time slot is no longer available." },
          { status: 409 },
        );
      }
      throw error;
    }
  } catch (error) {
    console.error("[booking/edit] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to update booking. Please try again." },
      { status: 500 },
    );
  }
}
