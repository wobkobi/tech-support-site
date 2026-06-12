// src/app/api/booking/edit/route.ts
/**
 * @file route.ts
 * @description API route to edit an existing booking by cancel token.
 */

import { getAvailabilityConfig } from "@/features/booking/lib/availability-config.server";
import {
  parseHourLabel,
  validateBookingPayloadFields,
  validateBookingRequest,
  type ExistingBooking,
  type JobDuration,
  type StartMinute,
  type TimeOfDay,
} from "@/features/booking/lib/booking";
import {
  createBookingEvent,
  deleteBookingEvent,
  fetchAllCalendarEvents,
} from "@/features/calendar/lib/google-calendar";
import { syncContactToGoogle } from "@/features/contacts/lib/google-contacts";
import {
  sendCustomerBookingConfirmation,
  sendOwnerBookingNotification,
} from "@/features/reviews/lib/email";
import { isValidPhone, toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getPacificAucklandOffset } from "@/shared/lib/timezone-utils";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

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
  const limited = rateLimitOrReject(request, "booking-edit", 5, 60_000);
  if (limited) return limited;

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

    // Validate payload fields
    const payloadCheck = validateBookingPayloadFields(
      { name, notes, dateKey, timeOfDay, duration, meetingType, address, phone },
      { requireEmail: false },
    );
    if (!payloadCheck.valid) {
      return NextResponse.json({ ok: false, error: payloadCheck.error }, { status: 400 });
    }

    const now = new Date();

    // Reschedule policy gate (cutoff + max-reschedules) from the live pricing
    // settings. 0 / null means the rule is off.
    const { reschedule } = (await getSettings()).pricing;
    const hoursUntilStart = (booking.startAt.getTime() - now.getTime()) / 3_600_000;
    if (reschedule.cutoffHours > 0 && hoursUntilStart < reschedule.cutoffHours) {
      return NextResponse.json(
        {
          ok: false,
          error: `Bookings can't be changed within ${reschedule.cutoffHours} hours of the appointment. Please call or text me and I'll sort it.`,
        },
        { status: 400 },
      );
    }
    if (
      reschedule.maxReschedules !== null &&
      booking.rescheduleCount >= reschedule.maxReschedules
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This booking has already been changed the maximum number of times. Please call or text me to reschedule.",
        },
        { status: 400 },
      );
    }

    // Editing an existing booking stays open even when new-booking intake is
    // paused; only the day's schedule + windows gate the new time.
    const { config } = await getAvailabilityConfig();
    const maxDate = new Date(now.getTime() + config.maxAdvanceDays * 24 * 60 * 60 * 1000);

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

    // Validate the requested slot
    const validation = validateBookingRequest(
      dateKey,
      timeOfDay,
      startMinute,
      duration,
      existingForValidation,
      calendarEvents,
      now,
      config,
    );

    if (!validation.valid) {
      return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
    }

    // Resolve the new slot from the validated hour label + live durations.
    const startHour = parseHourLabel(timeOfDay);
    if (startHour === null) {
      return NextResponse.json({ ok: false, error: "Invalid time or duration." }, { status: 400 });
    }
    const durationMinutes = duration === "short" ? config.durations.short : config.durations.long;
    const durationLabel = `${duration === "short" ? "Standard" : "Extended"} (${durationMinutes} min)`;
    const cleanDurationLabel = `${duration === "short" ? "Standard" : "Extended"} ${durationMinutes} min`;

    // Calculate start/end times
    const [year, month, day] = dateKey.split("-").map(Number);
    const utcOffset = getPacificAucklandOffset(year, month, day);
    const startAt = new Date(Date.UTC(year, month - 1, day, startHour - utcOffset, startMinute, 0));
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

    // Build updated notes
    let bookingNotes = `${notes.trim()}\n\n`;
    const timeLabel =
      startMinute === 0
        ? timeOfDay
        : timeOfDay.replace(/(am|pm)$/i, `:${String(startMinute).padStart(2, "0")}$1`);
    bookingNotes += `[${timeLabel} - ${durationLabel}]\n`;
    bookingNotes += `Meeting type: ${meetingType === "in-person" ? "In-person" : "Remote"}\n`;
    if (meetingType === "in-person" && address) {
      bookingNotes += `Address: ${address.trim()}\n`;
    }
    const phoneE164 = phone ? toE164NZ(phone) || null : null;
    if (phone && (!phoneE164 || !isValidPhone(phoneE164))) {
      return NextResponse.json(
        { ok: false, error: "Please enter a valid phone number, or leave it blank." },
        { status: 400 },
      );
    }
    if (phoneE164) {
      bookingNotes += `Phone: ${phoneE164}\n`;
    }

    // Replace the calendar event: delete the old one, then create at the new time.
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
      const summary = `Tech Support: ${name.trim()} - ${cleanDurationLabel}`;
      const calendarResult = await createBookingEvent({
        summary,
        description: bookingNotes,
        startAt,
        endAt,
        timeZone: config.timeZone,
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

    // Capture the original start time before mutating so the rescheduled
    // email notifications can show "was: <old time>".
    const previousStartAt = booking.startAt;

    // Update the booking
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
          bufferAfterMin: config.bookingBufferAfterMin,
          rescheduleCount: { increment: 1 },
          ...(phoneE164 !== undefined ? { phone: phoneE164 } : {}),
        },
      });
      console.log(`[booking/edit] Updated booking: ${booking.id}`);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json(
          { ok: false, error: "This time slot is no longer available." },
          { status: 409 },
        );
      }
      throw error;
    }

    // Upsert Contact + sync to Google. Best-effort: a failure here must not
    // fail the edit (the booking + calendar event are already saved). Contact
    // name/phone/address stay in step with the booking so edit-form
    // corrections propagate to Google Contacts.
    try {
      const contactEmail = booking.email.toLowerCase();
      const existing = await prisma.contact.findFirst({ where: { email: contactEmail } });
      let contactId: string | null = existing?.id ?? null;
      if (existing) {
        await prisma.contact.update({
          where: { id: existing.id },
          data: {
            name: name.trim(),
            ...(phoneE164 !== undefined ? { phone: phoneE164 } : {}),
            ...(meetingType === "in-person" && address ? { address: address.trim() } : {}),
          },
        });
      } else {
        const created = await prisma.contact.create({
          data: {
            name: name.trim(),
            email: contactEmail,
            phone: phoneE164,
            address: meetingType === "in-person" && address ? address.trim() : null,
          },
        });
        contactId = created.id;
      }
      if (contactId) {
        await syncContactToGoogle(contactId);
      }
    } catch (contactError) {
      console.error("[booking/edit] Failed to upsert/sync contact:", contactError);
    }

    // Notify customer + owner of the reschedule. Both helpers catch their own
    // errors and never throw - the edit's success doesn't depend on Resend.
    await Promise.all([
      sendCustomerBookingConfirmation(
        {
          id: booking.id,
          name: name.trim(),
          email: booking.email,
          notes: bookingNotes,
          startAt,
          endAt,
          cancelToken: booking.cancelToken,
          promoTitleAtBooking: booking.promoTitleAtBooking,
        },
        { kind: "rescheduled", previousStartAt },
      ),
      sendOwnerBookingNotification(
        {
          id: booking.id,
          name: name.trim(),
          email: booking.email,
          notes: bookingNotes,
          startAt,
          endAt,
          cancelToken: booking.cancelToken,
        },
        { kind: "rescheduled", previousStartAt },
      ),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[booking/edit] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to update booking. Please try again." },
      { status: 500 },
    );
  }
}
