// src/app/api/booking/hold/route.ts
/**
 * @file route.ts
 * @description API route to create a booking hold.
 * Validates the slot, creates a hold in the database, then confirms by creating
 * a Google Calendar event and sending confirmation email.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { BOOKING_CONFIG, validateSlot, type ExistingBooking } from "@/lib/booking";
import { releaseExpiredHolds, HOLD_EXPIRATION_MINUTES } from "@/lib/releaseExpiredHolds";
import { createBookingEvent } from "@/server/google/calendar";
import { randomUUID } from "crypto";

/**
 * Request payload for creating a booking.
 */
interface CreateBookingRequest {
  /** Client's full name. */
  name: string;
  /** Client's email address. */
  email: string;
  /** Optional notes from the client. */
  notes?: string;
  /** ISO string of the selected slot start time. */
  slotStartIso: string;
  /** ISO string of the selected slot end time. */
  slotEndIso: string;
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
 * Creates a booking, adds it to Google Calendar, and returns success.
 * @param request - The incoming request with booking details.
 * @returns JSON response indicating success or failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse<CreateBookingResponse>> {
  try {
    // Parse and validate request body
    const body = (await request.json()) as CreateBookingRequest;
    const { name, email, notes, slotStartIso, slotEndIso } = body;

    // Basic validation
    if (!name?.trim()) {
      return NextResponse.json({ ok: false, error: "Name is required." }, { status: 400 });
    }
    if (!email?.trim() || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "Valid email is required." }, { status: 400 });
    }
    if (!slotStartIso || !slotEndIso) {
      return NextResponse.json({ ok: false, error: "Slot times are required." }, { status: 400 });
    }

    // Release any expired holds first to free up slots
    await releaseExpiredHolds();

    // Get existing bookings for conflict check
    const now = new Date();
    const existingBookings = await prisma.booking.findMany({
      where: {
        status: { in: ["held", "confirmed"] },
        startUtc: { gte: now },
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

    // Validate the requested slot
    const validation = validateSlot(
      slotStartIso,
      slotEndIso,
      existingForValidation,
      now,
      BOOKING_CONFIG,
    );

    if (!validation.valid) {
      return NextResponse.json(
        { ok: false, error: validation.error || "Invalid slot." },
        { status: 400 },
      );
    }

    const startUtc = new Date(slotStartIso);
    const endUtc = new Date(slotEndIso);
    const cancelToken = randomUUID();
    const holdExpiresUtc = new Date(now.getTime() + HOLD_EXPIRATION_MINUTES * 60 * 1000);

    // Create the booking in the database (initially as held)
    const booking = await prisma.booking.create({
      data: {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        notes: notes?.trim() || null,
        startUtc,
        endUtc,
        status: "held",
        cancelToken,
        holdExpiresUtc,
        bufferBeforeMin: BOOKING_CONFIG.bufferMin,
        bufferAfterMin: BOOKING_CONFIG.bufferMin,
      },
    });

    // Create Google Calendar event
    let calendarEventId: string | null = null;
    try {
      const calendarResult = await createBookingEvent({
        summary: `Booking: ${name.trim()}`,
        description: `Client: ${name.trim()}\nEmail: ${email.trim()}\n${notes?.trim() ? `Notes: ${notes.trim()}` : ""}`.trim(),
        startUtc,
        endUtc,
        timeZone: BOOKING_CONFIG.timeZone,
        attendeeEmail: email.trim().toLowerCase(),
        attendeeName: name.trim(),
      });

      calendarEventId = calendarResult.eventId;
    } catch (calendarError) {
      // Log but continue - calendar integration is optional
      console.error("[booking/hold] Calendar event creation failed:", calendarError);
    }

    // Update booking to confirmed with calendar event ID
    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        status: "confirmed",
        calendarEventId,
        holdExpiresUtc: null, // Clear hold expiry since it's confirmed
      },
    });

    // TODO: Send confirmation email with ICS attachment
    // This would integrate with your email provider (e.g., Resend, SendGrid)

    return NextResponse.json({ ok: true, bookingId: booking.id });
  } catch (error) {
    console.error("[booking/hold] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to create booking. Please try again." },
      { status: 500 },
    );
  }
}
