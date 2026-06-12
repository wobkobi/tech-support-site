// src/app/api/admin/bookings/route.ts
/**
 * @file route.ts
 * @description Admin endpoint to create a booking manually (phone/email bookings
 * captured from the /admin/schedule grid). Accepts arbitrary startAt + duration
 * instead of the public slot model.
 */

import {
  BOOKING_CONFIG,
  BOOKING_FIELD_LIMITS,
  validateEmail,
} from "@/features/booking/lib/booking";
import {
  createBookingEvent,
  fetchAllCalendarEvents,
  SCHEDULE_CALENDAR_TAG,
} from "@/features/calendar/lib/google-calendar";
import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";
import { syncContactToGoogle } from "@/features/contacts/lib/google-contacts";
import { sendCustomerBookingConfirmation } from "@/features/reviews/lib/email";
import { isAdminRequest } from "@/shared/lib/auth";
import { validatePhone } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { revalidateTag } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

interface AdminBookingPayload {
  name?: string;
  email?: string;
  phone?: string | null;
  address?: string | null;
  notes?: string;
  startAt?: string;
  durationMinutes?: number;
  sendConfirmation?: boolean;
}

/**
 * POST /api/admin/bookings
 * Creates a confirmed booking at the given start time. Skips the public form's
 * slot/min-notice constraints since admin is authoritative.
 * @param request - Incoming admin request with x-admin-secret header.
 * @returns JSON with the new booking id or an error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Parse the payload; trim free-text fields and lowercase the email
  const body = (await request.json()) as AdminBookingPayload;
  const name = body.name?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const phoneRaw = body.phone?.trim() || null;
  const address = body.address?.trim() || null;
  const notes = body.notes?.trim() ?? "";
  const startAtStr = body.startAt;
  const durationMinutes = body.durationMinutes;
  const sendConfirmation = body.sendConfirmation === true;

  // Validate fields
  if (!name || name.length > BOOKING_FIELD_LIMITS.name) {
    return NextResponse.json({ ok: false, error: "Customer name is required." }, { status: 400 });
  }
  const emailCheck = validateEmail(email);
  if (emailCheck !== "ok") {
    const msg = emailCheck === "too-long" ? "Email is too long." : "Valid email is required.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
  if (notes.length > BOOKING_FIELD_LIMITS.notes) {
    return NextResponse.json({ ok: false, error: "Notes too long." }, { status: 400 });
  }
  if (address && address.length > BOOKING_FIELD_LIMITS.address) {
    return NextResponse.json({ ok: false, error: "Address too long." }, { status: 400 });
  }
  if (!startAtStr || isNaN(Date.parse(startAtStr))) {
    return NextResponse.json({ ok: false, error: "Invalid start time." }, { status: 400 });
  }
  if (durationMinutes !== 60 && durationMinutes !== 120) {
    return NextResponse.json(
      { ok: false, error: "Duration must be 60 or 120 minutes." },
      { status: 400 },
    );
  }

  let phoneE164: string | null = null;
  if (phoneRaw) {
    const phoneCheck = validatePhone(phoneRaw);
    if (phoneCheck.result !== "ok") {
      return NextResponse.json({ ok: false, error: "Invalid phone number." }, { status: 400 });
    }
    phoneE164 = phoneCheck.e164;
  }

  // Resolve start and end times
  const startAt = new Date(startAtStr);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  const now = new Date();

  if (startAt.getTime() < now.getTime() - 60 * 60 * 1000) {
    return NextResponse.json(
      { ok: false, error: "Cannot create bookings more than an hour in the past." },
      { status: 400 },
    );
  }

  // Collision check: any held/confirmed booking or calendar event overlapping
  // the requested window (no buffer applied - admin override).
  const conflictingBooking = await prisma.booking.findFirst({
    where: {
      status: { in: ["held", "confirmed"] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true },
  });
  if (conflictingBooking) {
    return NextResponse.json(
      { ok: false, error: "Another booking already occupies this slot." },
      { status: 409 },
    );
  }

  try {
    const rangeStart = new Date(startAt.getTime() - 60 * 60 * 1000);
    const rangeEnd = new Date(endAt.getTime() + 60 * 60 * 1000);
    const calendarEvents = await fetchAllCalendarEvents(rangeStart, rangeEnd);
    const overlap = calendarEvents.find((e) => {
      const eStart = new Date(e.start).getTime();
      const eEnd = new Date(e.end).getTime();
      return eStart < endAt.getTime() && eEnd > startAt.getTime();
    });
    if (overlap) {
      return NextResponse.json(
        {
          ok: false,
          error: `Calendar event "${overlap.summary ?? overlap.id}" overlaps this slot.`,
        },
        { status: 409 },
      );
    }
  } catch (err) {
    console.error("[admin/bookings] Calendar collision check failed:", err);
    // Fall through - admin override accepts the booking even if the live check fails.
  }

  const cancelToken = randomUUID();
  const reviewToken = randomUUID();

  // Build booking notes
  let bookingNotes = notes ? `${notes}\n\n` : "";
  bookingNotes += `[Manual entry by admin - ${durationMinutes} min]\n`;
  bookingNotes += `Meeting type: ${address ? "In-person" : "Remote"}\n`;
  if (address) bookingNotes += `Address: ${address}\n`;

  // Create the calendar event
  let calendarEventId: string | null = null;
  try {
    const summary = `Tech Support: ${name} - ${durationMinutes === 60 ? "1 hour" : "2 hours"}`;
    const result = await createBookingEvent({
      summary,
      description: bookingNotes,
      startAt,
      endAt,
      timeZone: BOOKING_CONFIG.timeZone,
      attendeeEmail: email,
      attendeeName: name,
      location: address ?? undefined,
    });
    calendarEventId = result.eventId;
  } catch (err) {
    console.error("[admin/bookings] Calendar event create failed:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to create calendar event." },
      { status: 500 },
    );
  }

  // Create the booking
  const { availability } = await getSettings();
  try {
    const booking = await prisma.booking.create({
      data: {
        name,
        email,
        phone: phoneE164,
        notes: bookingNotes,
        startAt,
        endAt,
        status: "confirmed",
        cancelToken,
        reviewToken,
        calendarEventId,
        activeSlotKey: startAt.toISOString(),
        bufferBeforeMin: 0,
        bufferAfterMin: availability.bookingBufferAfterMin,
      },
    });

    // Best-effort contact upsert + Google sync; never fail the booking on errors.
    try {
      const { contact } = await findOrCreateContactByEmail(email, {
        name,
        phone: phoneE164,
        address,
      });
      await syncContactToGoogle(contact.id);
    } catch (contactErr) {
      console.error("[admin/bookings] Contact upsert failed:", contactErr);
    }

    // Send the confirmation email
    if (sendConfirmation) {
      await sendCustomerBookingConfirmation({
        id: booking.id,
        name: booking.name,
        email: booking.email,
        notes: booking.notes ?? "",
        startAt: booking.startAt,
        endAt: booking.endAt,
        cancelToken: booking.cancelToken,
        promoTitleAtBooking: booking.promoTitleAtBooking,
      });
    }

    revalidateTag(SCHEDULE_CALENDAR_TAG, {});
    return NextResponse.json({ ok: true, bookingId: booking.id });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ ok: false, error: "This slot was just taken." }, { status: 409 });
    }
    console.error("[admin/bookings] Booking insert failed:", err);
    return NextResponse.json({ ok: false, error: "Failed to save booking." }, { status: 500 });
  }
}
