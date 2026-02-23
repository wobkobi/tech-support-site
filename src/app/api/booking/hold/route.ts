// src/app/api/booking/hold/route.ts
/**
 * @file route.ts
 * @description API route to create a booking hold with Google Calendar integration.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { BOOKING_CONFIG } from "@/lib/booking";
import { createBookingEvent } from "@/lib/google-calendar";
import { randomUUID } from "crypto";

// Hold expiration time in minutes
const HOLD_EXPIRATION_MINUTES = 15;

/**
 * Request payload for creating a booking.
 */
interface CreateBookingRequest {
  /** Client's full name. */
  name: string;
  /** Client's email address. */
  email: string;
  /** Client's phone number. */
  phone?: string;
  /** Optional notes from the client. */
  notes?: string;
  /** Date key YYYY-MM-DD. */
  dateKey: string;
  /** Slot start time HH:MM. */
  slotStart: string;
  /** Slot end time HH:MM. */
  slotEnd: string;
  /** Meeting type: in-person or remote. */
  meetingType: "in-person" | "remote";
  /** Address for in-person appointments. */
  address?: string;
}

/**
 * Response from creating a booking.
 */
interface CreateBookingResponse {
  /** Whether the booking was successfully created. */
  ok: boolean;
  /** The booking ID if successful. */
  bookingId?: string;
  /** Error message if not successful. */
  error?: string;
}

/**
 * POST /api/booking/hold
 * Creates a booking hold in the database and Google Calendar.
 * @param request - The incoming request with booking details.
 * @returns JSON response indicating success or failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse<CreateBookingResponse>> {
  try {
    // Parse and validate request body
    const body = (await request.json()) as CreateBookingRequest;
    const { name, email, phone, notes, dateKey, slotStart, slotEnd, meetingType, address } = body;

    // Basic validation
    if (!name?.trim()) {
      return NextResponse.json({ ok: false, error: "Name is required." }, { status: 400 });
    }
    if (!email?.trim() || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "Valid email is required." }, { status: 400 });
    }
    if (!dateKey || !slotStart || !slotEnd) {
      return NextResponse.json({ ok: false, error: "Please select a time slot." }, { status: 400 });
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

    // Parse date and time
    const [year, month, day] = dateKey.split("-").map(Number);
    const [startHour, startMinute] = slotStart.split(":").map(Number);
    const [endHour, endMinute] = slotEnd.split(":").map(Number);

    if (!year || !month || !day) {
      return NextResponse.json({ ok: false, error: "Invalid date format." }, { status: 400 });
    }

    // Create local NZ dates
    const startLocal = new Date(year, month - 1, day, startHour, startMinute, 0);
    const endLocal = new Date(year, month - 1, day, endHour, endMinute, 0);

    if (startLocal >= endLocal) {
      return NextResponse.json({ ok: false, error: "Invalid time range." }, { status: 400 });
    }

    if (startLocal < now) {
      return NextResponse.json(
        { ok: false, error: "Cannot book times in the past." },
        { status: 400 },
      );
    }

    // Convert to UTC for database storage
    const startUtc = new Date(startLocal.toISOString());
    const endUtc = new Date(endLocal.toISOString());

    const cancelToken = randomUUID();
    const holdExpiresUtc = new Date(now.getTime() + HOLD_EXPIRATION_MINUTES * 60 * 1000);

    // Build notes with meeting details
    let bookingNotes = `Meeting type: ${meetingType === "in-person" ? "In-person" : "Remote"}\n`;
    if (meetingType === "in-person" && address) {
      bookingNotes += `Address: ${address.trim()}\n`;
    }
    if (phone) {
      bookingNotes += `Phone: ${phone.trim()}\n`;
    }
    if (notes?.trim()) {
      bookingNotes += `\nNotes: ${notes.trim()}`;
    }

    // Create the booking in the database first
    const booking = await prisma.booking.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        notes: bookingNotes,
        startUtc,
        endUtc,
        status: "held",
        cancelToken,
        holdExpiresUtc,
        bufferBeforeMin: BOOKING_CONFIG.bufferMin,
        bufferAfterMin: BOOKING_CONFIG.bufferMin,
      },
    });

    // Try to create Google Calendar event
    let calendarEventId: string | null = null;
    try {
      const calendarResult = await createBookingEvent({
        summary: `Booking: ${name.trim()}`,
        description: bookingNotes,
        startUtc,
        endUtc,
        timeZone: BOOKING_CONFIG.timeZone,
        attendeeEmail: email.trim().toLowerCase(),
        attendeeName: name.trim(),
        location: meetingType === "in-person" && address ? address.trim() : undefined,
      });

      calendarEventId = calendarResult.eventId;

      // Update booking with calendar event ID and confirm it
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: "confirmed",
          calendarEventId,
          holdExpiresUtc: null, // Clear hold expiry since it's confirmed
        },
      });

      // ✅ Trigger on-demand revalidation of /booking page
      // Next user who visits /booking will see fresh slots reflecting this new booking
      revalidatePath("/booking");
    } catch (calendarError) {
      // Log but continue - calendar integration is optional
      console.error("[booking/hold] Calendar event creation failed:", calendarError);
      // Booking is still created in database, just without calendar event
    }

    return NextResponse.json({ ok: true, bookingId: booking.id });
  } catch (error) {
    console.error("[booking/hold] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to create booking. Please try again." },
      { status: 500 },
    );
  }
}
