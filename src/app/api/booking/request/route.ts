// src/app/api/booking/request/route.ts
/**
 * @file route.ts
 * @description API route with duration support (1hr vs 2hr jobs).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import {
  BOOKING_CONFIG,
  DURATION_OPTIONS,
  validateBookingRequest,
  TIME_OF_DAY_OPTIONS,
  type TimeOfDay,
  type StartMinute,
  type JobDuration,
  type ExistingBooking,
} from "@/features/booking/lib/booking";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import {
  createBookingEvent,
  fetchAllCalendarEvents,
} from "@/features/calendar/lib/google-calendar";
import {
  sendOwnerBookingNotification,
  sendCustomerBookingConfirmation,
} from "@/features/reviews/lib/email";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { syncContactToGoogle } from "@/features/contacts/lib/google-contacts";
import { toE164NZ } from "@/shared/lib/normalize-phone";

interface BookingRequestPayload {
  dateKey: string;
  timeOfDay: TimeOfDay;
  startMinute?: StartMinute;
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
    const {
      dateKey,
      timeOfDay,
      startMinute = 0,
      duration,
      name,
      email,
      phone,
      address,
      meetingType,
      notes,
    } = body;

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

    // Get dynamic UTC offset for this date (handles NZDT/NZST)
    const utcOffset = getPacificAucklandOffset(year, month, day);
    const startAt = new Date(Date.UTC(year, month - 1, day, startHour - utcOffset, startMinute, 0));
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

    const cancelToken = randomUUID();
    const reviewToken = randomUUID();

    // Build notes
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
    // Create calendar event
    let calendarEventId: string | null = null;
    try {
      // Remove parentheses from duration label for summary to avoid double brackets
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
    try {
      const booking = await prisma.booking.create({
        data: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          phone: phone ? toE164NZ(phone) || null : null,
          notes: bookingNotes,
          startAt,
          endAt,
          status: "confirmed",
          cancelToken,
          reviewToken,
          calendarEventId,
          activeSlotKey: startAt.toISOString(), // Unique constraint for double-booking prevention
          bufferBeforeMin: 0,
          bufferAfterMin: BOOKING_CONFIG.bookingBufferAfterMin,
        },
      });

      console.log(`[booking/request] Created ${duration} booking: ${booking.id}`);

      // Upsert contact record - best effort, never fail the booking on write error
      try {
        const contactEmail = email.trim().toLowerCase();
        let existing = await prisma.contact.findFirst({ where: { email: contactEmail } });
        if (!existing) {
          existing = await prisma.contact.create({
            data: {
              name: name.trim(),
              email: contactEmail,
              phone: phone ? toE164NZ(phone) || null : null,
              address: address?.trim() || null,
            },
          });
        }
        const contact = existing;
        // Best-effort sync to Google Contacts — never fail the booking if it errors.
        await syncContactToGoogle(contact.id);
      } catch (contactError) {
        console.error("[booking/request] Failed to upsert contact:", contactError);
      }

      // Send confirmation emails before returning so Vercel doesn't kill the
      // function before the Resend requests complete. Both functions catch all
      // errors internally and never throw.
      await Promise.all([
        sendOwnerBookingNotification({
          id: booking.id,
          name: booking.name,
          email: booking.email,
          notes: booking.notes ?? "",
          startAt: booking.startAt,
          endAt: booking.endAt,
          cancelToken: booking.cancelToken,
        }),
        sendCustomerBookingConfirmation({
          id: booking.id,
          name: booking.name,
          email: booking.email,
          notes: booking.notes ?? "",
          startAt: booking.startAt,
          endAt: booking.endAt,
          cancelToken: booking.cancelToken,
        }),
      ]);

      return NextResponse.json({
        ok: true,
        bookingId: booking.id,
        cancelToken: booking.cancelToken,
      });
    } catch (error) {
      // Handle unique constraint violation (concurrent booking for same slot)
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        console.warn("[booking/request] Concurrent booking conflict", {
          activeSlotKey: startAt.toISOString(),
          email: email.trim().toLowerCase(),
          timestamp: new Date().toISOString(),
        });
        return NextResponse.json(
          { ok: false, error: "This time slot is no longer available." },
          { status: 409 },
        );
      }
      // Re-throw other errors to be caught by outer handler
      throw error;
    }
  } catch (error) {
    console.error("[booking/request] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to submit request. Please try again." },
      { status: 500 },
    );
  }
}
