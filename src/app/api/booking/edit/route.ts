// src/app/api/booking/edit/route.ts
// API route to edit an existing booking by cancel token.

import { getAvailabilityConfig } from "@/features/booking/lib/availability-config.server";
import {
  buildAppointmentDescription,
  isBookingClosed,
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
} from "@/features/reviews/lib/email-booking";
import { cancelHeldBookingEmails } from "@/features/reviews/lib/email-core";
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
import { dateKeyParts, nzWallClockUtc } from "@/shared/lib/timezone-utils";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

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
  accessNotes?: string;
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
      accessNotes,
    } = body;
    // A filter object here would load and rewrite somebody else's booking.
    const cancelToken = parseString(body.cancelToken);

    if (!cancelToken) {
      return errorResponse("Missing cancel token.", 400);
    }

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
    // Holds even with the reschedule cutoff turned off (cutoffHours 0).
    if (isBookingClosed(booking, new Date())) {
      return errorResponse(
        "This appointment has already started or finished, so it can't be changed online. Please call or text me and I'll sort it.",
        400,
      );
    }

    const payloadCheck = validateBookingPayloadFields(
      { name, notes, accessNotes, dateKey, timeOfDay, duration, meetingType, address, phone },
      { requireEmail: false },
    );
    if (!payloadCheck.valid) {
      return errorResponse(payloadCheck.error, 400);
    }

    // Canonicalise the address so booking, event and contact agree; keep the typed
    // value when Google has no single confident match.
    const cleanName = normaliseName(name) || name.trim();
    const phoneValidation = validatePhone(phone ?? "", { nzOnly: true });
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

    // Reschedule cutoff + max count; 0 / null turns a rule off.
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

    // Edits stay open while new-booking intake is paused.
    const { config } = await getAvailabilityConfig();
    const maxDate = new Date(now.getTime() + config.maxAdvanceDays * 24 * 60 * 60 * 1000);

    // Excluding the one being edited, so it can keep its own slot.
    const existingForValidation = await loadBlockingBookings(now, { excludeId: booking.id });

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

    const [year, month, day] = dateKeyParts(dateKey);
    const startAt = nzWallClockUtc(year, month, day, startHour, startMinute);
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

    const cleanAccessNotes = typeof accessNotes === "string" ? accessNotes.trim() || null : null;

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

    // The customer is an attendee, so the invite gets the customer-facing description.
    const identity = await getIdentity();
    const siteUrl = getSiteUrl();
    const calendarDescription = buildAppointmentDescription({
      company: identity.company,
      phone: identity.phone,
      email: identity.email,
      isRemote: meetingType === "remote",
      userNotes: notes.trim(),
      accessNotes: cleanAccessNotes,
      manageUrl: `${siteUrl}/booking/edit?token=${encodeURIComponent(booking.cancelToken)}`,
      cancelUrl: `${siteUrl}/booking/cancel?token=${encodeURIComponent(booking.cancelToken)}`,
    });

    // Create the replacement BEFORE retiring the old event, so a Google failure leaves a
    // recoverable duplicate, not a booking pointing at a dead calendarEventId.
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
      // The original event is untouched, so the customer can simply retry.
      return NextResponse.json(
        { ok: false, error: "Failed to update calendar event. Please try again." },
        { status: 500 },
      );
    }

    // Best-effort: a failure leaves a stale duplicate for the operator to clear.
    if (booking.calendarEventId) {
      try {
        await deleteBookingEvent({ eventId: booking.calendarEventId });
      } catch (err) {
        console.error("[booking/edit] Failed to delete old calendar event:", err);
      }
    }

    // For the "was: <old time>" line in the rescheduled emails.
    const previousStartAt = booking.startAt;

    // Re-snapshot drive legs so a late cancel bills the right travel; remote leaves both null.
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

    try {
      // Conditional on still being active: a cancel that landed mid-edit keeps its released
      // slot key instead of this write handing the slot back to a cancelled booking.
      const saved = await prisma.booking.updateMany({
        where: { id: booking.id, status: "confirmed" },
        data: {
          name: cleanName,
          notes: bookingNotes,
          accessNotes: cleanAccessNotes,
          startAt,
          endAt,
          calendarEventId,
          activeSlotKey: startAt.toISOString(),
          bufferAfterMin: config.bookingBufferAfterMin,
          rescheduleCount: { increment: 1 },
          // Clear the reminder stamp so the 24h nudge fires again, but only when the
          // start moved - a notes-only edit shouldn't re-send it.
          ...(startAt.getTime() !== booking.startAt.getTime() ? { emailReminderSentAt: null } : {}),
          phone: phoneE164,
          // Keep snapshots current for the cancellation invoice.
          address: canonicalAddress ? splitUnitFromAddress(canonicalAddress).rest : null,
          unit: canonicalAddress ? splitUnitFromAddress(canonicalAddress).unit || null : null,
          meetingType: meetingType === "in-person" ? "in_person" : "remote",
          duration,
          travelMinsAtBooking,
          travelMinsBackAtBooking,
        },
      });
      if (saved.count === 0) {
        if (calendarEventId) {
          await deleteBookingEvent({ eventId: calendarEventId }).catch((err) =>
            console.error("[booking/edit] Failed to delete orphaned calendar event:", err),
          );
        }
        return errorResponse(
          "This booking was cancelled or completed, so it can't be changed.",
          409,
        );
      }
      console.log(`[booking/edit] Updated booking: ${booking.id}`);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // Lost the slot race; remove the now-orphaned new event.
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

    // Held emails name the old time. Same gate as the reminder-stamp clear above,
    // or a recalled reminder would never re-send.
    if (startAt.getTime() !== booking.startAt.getTime()) {
      await cancelHeldBookingEmails(booking.id);
    }

    // Best-effort contact upsert + Google sync; the booking is already saved.
    try {
      // Shared helper: case-insensitive and never resurrects a deleted contact.
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

    // Helpers never throw. Only the settings read can, so its failure just drops the push.
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
          accessNotes: cleanAccessNotes,
          startAt,
          endAt,
          cancelToken: booking.cancelToken,
          promoTitleAtBooking: booking.promoTitleAtBooking,
          address: canonicalAddress ?? "",
          meetingType: meetingType === "in-person" ? "in_person" : "remote",
          // Post-increment value, or the invite's SEQUENCE won't rise and clients ignore it.
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
          accessNotes: cleanAccessNotes,
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
