// src/app/api/booking/edit/route.ts
/**
 * @description API route to edit an existing booking by cancel token.
 */

import { getAvailabilityConfig } from "@/features/booking/lib/availability-config.server";
import {
  parseHourLabel,
  splitUnitFromAddress,
  validateBookingPayloadFields,
  validateBookingRequest,
  type ExistingBooking,
  type JobDuration,
  type StartMinute,
  type TimeOfDay,
} from "@/features/booking/lib/booking";
import { lookupDriveRoundTrip } from "@/features/business/lib/travel-distance";
import {
  createBookingEvent,
  deleteBookingEvent,
  fetchAllCalendarEvents,
} from "@/features/calendar/lib/google-calendar";
import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";
import { syncContactToGoogle } from "@/features/contacts/lib/google-contacts";
import {
  sendCustomerBookingConfirmation,
  sendOwnerBookingNotification,
} from "@/features/reviews/lib/email";
import { errorResponse } from "@/shared/lib/api-response";
import { normaliseAddress } from "@/shared/lib/normalise-address";
import { normaliseName } from "@/shared/lib/normalise-name";
import { validatePhone } from "@/shared/lib/normalise-phone";
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
      return errorResponse("Missing cancel token.", 400);
    }

    // Find booking
    const booking = await prisma.booking.findFirst({ where: { cancelToken } });
    if (!booking) {
      return errorResponse("Booking not found.", 404);
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
      return errorResponse(payloadCheck.error, 400);
    }

    // Tidy the name, validate the phone, and Google-canonicalise a typed address
    // (unambiguous matches only - see normaliseAddress) so the edited booking,
    // calendar event, and contact all carry a verified address. Falls back to
    // the typed value when Google has no single confident match.
    const cleanName = normaliseName(name) || name.trim();
    const phoneValidation = validatePhone(phone ?? "");
    if (phoneValidation.result === "invalid") {
      return NextResponse.json(
        { ok: false, error: "Please enter a valid phone number, or leave it blank." },
        { status: 400 },
      );
    }
    const phoneE164 = phoneValidation.e164 || null;
    const canonicalAddress =
      meetingType === "in-person" && address?.trim()
        ? ((await normaliseAddress(address.trim())) ?? address.trim())
        : (address?.trim() ?? null);

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
      return errorResponse(
        "This booking has already been changed the maximum number of times. Please call or text me to reschedule.",
        400,
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
      return errorResponse(validation.error, 400);
    }

    // Resolve the new slot from the validated hour label + live durations.
    const startHour = parseHourLabel(timeOfDay);
    if (startHour === null) {
      return errorResponse("Invalid time or duration.", 400);
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
    if (meetingType === "in-person" && canonicalAddress) {
      bookingNotes += `Address: ${canonicalAddress}\n`;
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
      const summary = `Tech Support: ${cleanName} - ${cleanDurationLabel}`;
      const calendarResult = await createBookingEvent({
        summary,
        description: bookingNotes,
        startAt,
        endAt,
        timeZone: config.timeZone,
        attendeeEmail: booking.email,
        attendeeName: cleanName,
        location: meetingType === "in-person" && canonicalAddress ? canonicalAddress : undefined,
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

    // Re-snapshot both drive legs for the (possibly new) address and times -
    // outbound at the new start, return at the new end - so a late cancel
    // bills the correct travel. Remote leaves both null so switching
    // in-person > remote drops the old round-trip charge. Non-blocking on error.
    let travelMinsAtBooking: number | null = null;
    let travelMinsBackAtBooking: number | null = null;
    if (meetingType === "in-person" && canonicalAddress) {
      try {
        const drive = await lookupDriveRoundTrip(canonicalAddress, startAt, endAt);
        if (drive.status === "ok") {
          travelMinsAtBooking = drive.data.there.durationMins;
          travelMinsBackAtBooking = drive.data.back.durationMins;
        }
      } catch (err) {
        console.warn("[booking/edit] travel-time snapshot failed:", err);
      }
    }

    // Update the booking
    try {
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          name: cleanName,
          notes: bookingNotes,
          startAt,
          endAt,
          calendarEventId,
          activeSlotKey: startAt.toISOString(),
          bufferAfterMin: config.bookingBufferAfterMin,
          rescheduleCount: { increment: 1 },
          phone: phoneE164,
          // Keep the structured snapshots in step with the edit so the
          // cancellation invoice reads the current address / meeting type /
          // duration rather than the original booking's values.
          address: canonicalAddress ? splitUnitFromAddress(canonicalAddress).rest : null,
          unit: canonicalAddress ? splitUnitFromAddress(canonicalAddress).unit || null : null,
          meetingType: meetingType === "in-person" ? "in_person" : "remote",
          duration,
          travelMinsAtBooking,
          travelMinsBackAtBooking,
        },
      });
      console.log(`[booking/edit] Updated booking: ${booking.id}`);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // The update lost the slot race; the new calendar event created above is
        // now an orphan (the old one was already deleted). Best-effort clean it
        // up so no ghost invite sits at the rejected time.
        if (calendarEventId) {
          await deleteBookingEvent({ eventId: calendarEventId }).catch((err) =>
            console.error("[booking/edit] Failed to delete orphaned calendar event:", err),
          );
        }
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
      // Route through the shared helper so matching is case-insensitive and
      // soft-delete-aware (never resurrecting a deleted contact), then keep the
      // contact's fields in step with the edited booking.
      const { contact } = await findOrCreateContactByEmail(booking.email, {
        name: cleanName,
        phone: phoneE164,
        address: canonicalAddress,
      });
      await prisma.contact.update({
        where: { id: contact.id },
        data: {
          name: cleanName,
          phone: phoneE164,
          ...(canonicalAddress ? { address: canonicalAddress } : {}),
        },
      });
      await syncContactToGoogle(contact.id);
    } catch (contactError) {
      console.error("[booking/edit] Failed to upsert/sync contact:", contactError);
    }

    // Notify customer + owner of the reschedule. Both helpers catch their own
    // errors and never throw - the edit's success doesn't depend on Resend.
    await Promise.all([
      sendCustomerBookingConfirmation(
        {
          id: booking.id,
          name: cleanName,
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
          name: cleanName,
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
