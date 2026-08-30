// src/app/api/booking/edit/route.ts
/**
 * @description API route to edit an existing booking by cancel token.
 */

import { getAvailabilityConfig } from "@/features/booking/lib/availability-config.server";
import {
  buildAppointmentDescription,
  parseHourLabel,
  splitUnitFromAddress,
  validateBookingPayloadFields,
  validateBookingRequest,
  type JobDuration,
  type StartMinute,
  type TimeOfDay,
} from "@/features/booking/lib/booking";
import { loadBlockingBookings } from "@/features/booking/lib/existing-bookings.server";
import { lookupDriveRoundTrip } from "@/features/business/lib/travel-distance";
import { parseString } from "@/features/business/lib/validation";
import {
  createBookingEvent,
  deleteBookingEvent,
  fetchAllCalendarEvents,
} from "@/features/calendar/lib/google-calendar";
import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";
import { syncContactToGoogle } from "@/features/contacts/lib/google-contacts";
import { sendOwnerPush } from "@/features/notifications/lib/push";
import {
  sendCustomerBookingConfirmation,
  sendOwnerBookingNotification,
} from "@/features/reviews/lib/email";
import { errorResponse } from "@/shared/lib/api-response";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { normaliseAddress } from "@/shared/lib/normalise-address";
import { normaliseName } from "@/shared/lib/normalise-name";
import { validatePhone } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";
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
    // parseString, not a bare destructure: the payload type is a compile-time
    // claim only, and a filter object here would load somebody else's booking
    // and rewrite it.
    const cancelToken = parseString(body.cancelToken);

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

    // Canonicalise a typed address (unambiguous matches only - see normaliseAddress) so
    // the booking, calendar event and contact all carry the same verified one. Falls back
    // to the typed value when Google has no single confident match.
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

    // Excluding the one being edited, so it can keep its own slot.
    const existingForValidation = await loadBlockingBookings(now, { excludeId: booking.id });

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

    // Internal blob above; the customer is an attendee on the replacement event,
    // so the invite gets the customer-facing description rather than the raw
    // metadata (which now also carries their phone number).
    const identity = await getIdentity();
    const siteUrl = getSiteUrl();
    const calendarDescription = buildAppointmentDescription({
      company: identity.company,
      phone: identity.phone,
      email: identity.email,
      isRemote: meetingType === "remote",
      userNotes: notes.trim(),
      manageUrl: `${siteUrl}/booking/edit?token=${encodeURIComponent(booking.cancelToken)}`,
      cancelUrl: `${siteUrl}/booking/cancel?token=${encodeURIComponent(booking.cancelToken)}`,
    });

    // Create the replacement BEFORE retiring the old event: a Google 5xx on the create
    // then leaves a recoverable duplicate rather than a confirmed booking pointing at a
    // dead calendarEventId. Slot validation above excludes this booking's own event, so
    // the momentary overlap can't fail the conflict check.
    let calendarEventId: string | null = null;
    try {
      const summary = `Tech Support: ${cleanName} - ${cleanDurationLabel}`;
      const calendarResult = await createBookingEvent({
        summary,
        description: calendarDescription,
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
      // The original event is untouched, so the appointment still stands at its
      // old time and the customer can simply try again.
      return NextResponse.json(
        { ok: false, error: "Failed to update calendar event. Please try again." },
        { status: 500 },
      );
    }

    // Replacement is live - retire the old event. Best-effort: a failure here
    // leaves a stale duplicate for the operator to clear, which is far better
    // than the appointment disappearing.
    if (booking.calendarEventId) {
      try {
        await deleteBookingEvent({ eventId: booking.calendarEventId });
      } catch (err) {
        console.error("[booking/edit] Failed to delete old calendar event:", err);
      }
    }

    // Capture the original start time before mutating so the rescheduled
    // email notifications can show "was: <old time>".
    const previousStartAt = booking.startAt;

    // Re-snapshot both drive legs for the (possibly new) address and times so a late
    // cancel bills the correct travel. Remote leaves both null, so switching
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
          // Clear the reminder stamp so the 24h nudge fires again at the new time -
          // nothing else ever clears it, so a moved booking would lose the nudge that
          // stops no-shows. Gated on the start moving, so a notes-only edit doesn't
          // re-send a reminder the customer already has.
          ...(startAt.getTime() !== booking.startAt.getTime() ? { emailReminderSentAt: null } : {}),
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

    // Upsert Contact + sync to Google so edit-form corrections reach Google Contacts.
    // Best-effort: the booking and calendar event are already saved, so a failure here
    // must not fail the edit.
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

    // Notify customer + owner of the reschedule. Every helper catches its own
    // errors and never throws - the edit's success doesn't depend on Resend or
    // on the push service. The settings read is the one thing here that can
    // throw, and the reschedule has already committed, so a failure drops the
    // optional push rather than reporting a successful edit as failed.
    const comms = await getSettings()
      .then((s) => s.comms)
      .catch(() => null);
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
          address: canonicalAddress ?? "",
          meetingType: meetingType === "in-person" ? "in_person" : "remote",
          // The update above incremented it, so the stored count is one ahead
          // of the value loaded into `booking` - use the incremented one or the
          // calendar entry's SEQUENCE won't rise and clients ignore the update.
          rescheduleCount: booking.rescheduleCount + 1,
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
          address: canonicalAddress ?? "",
          meetingType: meetingType === "in-person" ? "in_person" : "remote",
        },
        { kind: "rescheduled", previousStartAt },
      ),
      ...(comms?.pushOnBooking
        ? [
            sendOwnerPush({
              title: "Booking rescheduled",
              // Name and time only - this renders on a lock screen.
              body: `${cleanName} - now ${formatDateTimeShort(startAt)}`,
              url: `/admin/bookings/${booking.id}`,
              tag: `booking-${booking.id}`,
            }),
          ]
        : []),
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
