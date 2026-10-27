// src/app/api/booking/request/route.ts
// API route with duration support (1hr vs 2hr jobs).

import { getAvailabilityConfig } from "@/features/booking/lib/availability-config.server";
import {
  bookingWindowEnd,
  buildAppointmentDescription,
  combineUnitAndAddress,
  isSlotFree,
  parseHourLabel,
  PHONE_INVALID_MESSAGE,
  splitUnitFromAddress,
  validateBookingPayloadFields,
  validateBookingRequest,
  type JobDuration,
  type StartMinute,
  type TimeOfDay,
} from "@/features/booking/lib/booking";
import { lookupBookingSnapshots } from "@/features/booking/lib/booking-snapshots.server";
import {
  loadBlockingBookings,
  loadBlockingEvents,
} from "@/features/booking/lib/existing-bookings.server";
import { formatQuotedRange } from "@/features/business/lib/estimate-range";

import { recordPromoRedemption } from "@/features/business/lib/promo-redemption";
import {
  bookingPromoColumns,
  describeRecurringWindow,
  resolvePromo,
} from "@/features/business/lib/promos";

import { parseObjectId } from "@/features/business/lib/validation";
import { createBookingEvent } from "@/features/calendar/lib/google-calendar";
import { removeBookingEvent } from "@/features/calendar/lib/pending-calendar-deletes";
import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";
import { syncContactToGoogle } from "@/features/contacts/lib/google-contacts";
import { optOutByEmail, optOutContact } from "@/features/mailing/lib/opt-out";
import { sendOwnerPush } from "@/features/notifications/lib/push";
import {
  sendCustomerBookingConfirmation,
  sendOwnerBookingNotification,
} from "@/features/reviews/lib/email-booking";
import { errorResponse } from "@/shared/lib/api-response";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { checkEmailDomain } from "@/shared/lib/email-domain.server";
import { normaliseAddress } from "@/shared/lib/normalise-address";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { normaliseName } from "@/shared/lib/normalise-name";
import { validatePhone } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";
import { dateKeyParts, nzWallClockUtc } from "@/shared/lib/timezone-utils";
import { Prisma, type AiEstimateCategory, type EstimateTask } from "@prisma/client";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

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
  /** Optional parking / directions / access notes from the form's second box. */
  accessNotes?: string;
  /** Honeypot field - real users never fill this; bots usually do. */
  website?: string;
  /**
   * Client UUID per form mount, logged to correlate retries. The `activeSlotKey`
   * unique constraint is what prevents double-booking.
   */
  idempotencyKey?: string;
  /** Id of the PriceEstimateLog the customer saw before booking, if any. */
  estimateId?: string;
  /** Promo code the customer entered. Never trusted - re-resolved server-side. */
  promoCode?: string;
  /** The mailing-list tickbox: false opts them out; true or missing changes nothing. */
  mailingList?: boolean;
}

/**
 * POST /api/booking/request
 * Creates a booking with calendar event for the specified duration
 * @param request - Next.js request object containing booking details
 * @returns JSON response with booking ID or error message
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "booking-request", 5, 60_000);
  if (limited) return limited;

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
      accessNotes,
      website,
      idempotencyKey,
      estimateId,
      promoCode,
      mailingList,
    } = body;

    if (idempotencyKey) {
      console.log(`[booking/request] idempotencyKey=${idempotencyKey}`);
    }

    // Reject a malformed phone before any calendar / DB work runs.
    const phoneValidation = validatePhone(phone ?? "", { nzOnly: true });
    if (phoneValidation.result === "invalid") {
      return NextResponse.json(
        { ok: false, error: `${PHONE_INVALID_MESSAGE} Or leave it blank.` },
        { status: 400 },
      );
    }
    const phoneE164 = phoneValidation.e164 || null;

    // Honeypot trip: fake success so the bot moves on.
    if (typeof website === "string" && website.trim().length > 0) {
      console.warn("[booking/request] Honeypot tripped; faking success.", {
        ip: request.headers.get("x-forwarded-for") ?? "unknown",
      });
      return NextResponse.json({ ok: true });
    }

    const payloadCheck = validateBookingPayloadFields(
      {
        name,
        email,
        notes,
        accessNotes,
        dateKey,
        timeOfDay,
        duration,
        meetingType,
        address,
        phone,
      },
      { requireEmail: true },
    );
    if (!payloadCheck.valid) {
      return errorResponse(payloadCheck.error, 400);
    }
    // The format check passes a made-up domain like "bgp.bgp"; DNS shows it can't
    // take mail. An unanswered lookup lets the booking through.
    if ((await checkEmailDomain(email)) === "no-mail") {
      return errorResponse(
        "That email address can't receive email. Please check it for typos.",
        400,
      );
    }

    // normaliseAddress only formats an UNAMBIGUOUS match; fall back to the typed value
    // so a new address still books.
    const cleanName = normaliseName(name) || name.trim();
    const normalisedEmail = normaliseEmail(email);
    const canonicalAddress =
      meetingType === "in-person" && address?.trim()
        ? ((await normaliseAddress(address.trim())) ?? address.trim())
        : (address?.trim() ?? null);

    const now = new Date();
    // Read settings before creating anything, or a failed read would 500 a booking
    // that went through and the customer would book again.
    const [{ config, acceptingBookings }, settings] = await Promise.all([
      getAvailabilityConfig(),
      getSettings(),
    ]);
    if (!acceptingBookings) {
      return NextResponse.json(
        { ok: false, error: "Online booking is currently paused." },
        { status: 400 },
      );
    }
    const existingForValidation = await loadBlockingBookings(now);

    // Fail closed: without every calendar read a collision can't be ruled out.
    let calendarEvents: Array<{ id: string; start: string; end: string }>;
    try {
      calendarEvents = await loadBlockingEvents(now, bookingWindowEnd(now, config));
    } catch (error) {
      console.error("[booking/request] Failed to fetch calendar events:", error);
      return NextResponse.json(
        {
          ok: false,
          error:
            "We couldn't verify availability just now. Please try again in a moment, or contact us directly.",
        },
        { status: 503 },
      );
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

    // Resolve the slot from the (already-validated) hour label + live durations.
    const startHour = parseHourLabel(timeOfDay);
    if (startHour === null) {
      return errorResponse("Invalid time or duration", 400);
    }
    const durationMinutes = duration === "short" ? config.durations.short : config.durations.long;

    const [year, month, day] = dateKeyParts(dateKey);

    const startAt = nzWallClockUtc(year, month, day, startHour, startMinute);
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

    const cancelToken = randomUUID();
    const reviewToken = randomUUID();

    // Snapshot the quote the customer saw; fields are copied so they survive the
    // estimate-log purge. priceLow/priceHigh are the all-in total.
    let quotedLowAtBooking: number | null = null;
    let quotedHighAtBooking: number | null = null;
    let quotedTravelAtBooking: number | null = null;
    let quotedDescriptionAtBooking: string | null = null;
    let quotedMinsAtBooking: number | null = null;
    let quotedCategoryAtBooking: AiEstimateCategory | null = null;
    let quotedTasksAtBooking: EstimateTask[] = [];
    if (parseObjectId(estimateId)) {
      const est = await prisma.priceEstimateLog
        .findUnique({ where: { id: estimateId } })
        .catch(() => null);
      if (est) {
        quotedLowAtBooking = est.priceLow;
        quotedHighAtBooking = est.priceHigh;
        quotedTravelAtBooking = est.travelCharge;
        quotedDescriptionAtBooking = est.description;
        quotedMinsAtBooking = est.aiEstimatedMins;
        quotedCategoryAtBooking = est.aiCategory;
        quotedTasksAtBooking = est.aiTasks;
      }
    }

    const cleanAccessNotes = typeof accessNotes === "string" ? accessNotes.trim() || null : null;

    let bookingNotes = `${notes.trim()}\n\n`;
    const timeLabel =
      startMinute === 0
        ? timeOfDay
        : timeOfDay.replace(/(am|pm)$/i, `:${String(startMinute).padStart(2, "0")}$1`);
    const durationLabel = `${duration === "short" ? "Standard" : "Extended"} (${durationMinutes} min)`;
    bookingNotes += `[${timeLabel} - ${durationLabel}]\n`;
    bookingNotes += `Meeting type: ${meetingType === "in-person" ? "In-person" : "Remote"}\n`;
    if (meetingType === "in-person" && canonicalAddress) {
      bookingNotes += `Address: ${canonicalAddress}\n`;
    }
    if (quotedLowAtBooking !== null && quotedHighAtBooking !== null) {
      // Same helper as the admin price-snapshot card, so the two always agree.
      bookingNotes += `Quoted: ${formatQuotedRange(quotedLowAtBooking, quotedHighAtBooking, quotedTravelAtBooking)}\n`;
    }

    // The customer is an attendee, so the invite must never carry the internal notes
    // (quoted price, metadata).
    const identity = await getIdentity();
    const siteUrl = getSiteUrl();
    const calendarDescription = buildAppointmentDescription({
      company: identity.company,
      phone: identity.phone,
      email: identity.email,
      isRemote: meetingType === "remote",
      userNotes: notes.trim(),
      accessNotes: cleanAccessNotes,
      manageUrl: `${siteUrl}/booking/edit?token=${encodeURIComponent(cancelToken)}`,
      cancelUrl: `${siteUrl}/booking/cancel?token=${encodeURIComponent(cancelToken)}`,
    });

    let calendarEventId: string | null = null;
    try {
      const cleanDurationLabel = `${duration === "short" ? "Standard" : "Extended"} ${durationMinutes} min`;
      const summary = `Tech Support: ${cleanName} - ${cleanDurationLabel}`;
      const calendarResult = await createBookingEvent({
        summary,
        description: calendarDescription,
        startAt,
        endAt,
        timeZone: config.timeZone,
        attendeeEmail: normalisedEmail,
        attendeeName: cleanName,
        location: meetingType === "in-person" && canonicalAddress ? canonicalAddress : undefined,
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

    // Snapshot rates, travel, holiday and promo so the quote survives later edits. Promo
    // dates are judged at booking time, weekday/time-of-day at startAt; the email lets
    // per-customer limits bind before a Contact exists.
    const [snapshots, activePromo] = await Promise.all([
      lookupBookingSnapshots({
        startAt,
        endAt,
        address: meetingType === "in-person" ? canonicalAddress : null,
        travelRatePerHour: settings.pricing.travelRatePerHour,
        logTag: "booking/request",
      }),
      resolvePromo({ at: startAt, bookedAt: new Date(), code: promoCode, email }).catch((err) => {
        console.warn("[booking/request] promo resolution failed:", err);
        return null;
      }),
    ]);

    // Until the row exists, a failure leaves the new event orphaned.
    let bookingCreated = false;
    try {
      const booking = await prisma.booking.create({
        data: {
          name: cleanName,
          email: normalisedEmail,
          phone: phoneE164,
          notes: bookingNotes,
          accessNotes: cleanAccessNotes,
          startAt,
          endAt,
          status: "confirmed",
          cancelToken,
          reviewToken,
          calendarEventId,
          activeSlotKey: startAt.toISOString(), // Unique constraint for double-booking prevention
          bufferBeforeMin: 0,
          bufferAfterMin: config.bookingBufferAfterMin,
          // Notes stay dual-written for regex-parsing admin code.
          address: canonicalAddress ? splitUnitFromAddress(canonicalAddress).rest : null,
          unit: canonicalAddress ? splitUnitFromAddress(canonicalAddress).unit || null : null,
          meetingType: meetingType === "in-person" ? "in_person" : "remote",
          duration,
          ...snapshots,
          // Promo snapshot denormalised - survives Promo deletion before service.
          ...bookingPromoColumns(activePromo),
          // The public quote the customer saw and how the AI read their request.
          quotedLowAtBooking,
          quotedHighAtBooking,
          quotedTravelAtBooking,
          quotedDescriptionAtBooking,
          quotedMinsAtBooking,
          quotedCategoryAtBooking,
          quotedTasksAtBooking,
        },
      });

      bookingCreated = true;
      console.log(`[booking/request] Created ${duration} booking: ${booking.id}`);

      // activeSlotKey only stops an identical start, so two overlapping requests checked
      // in the same moment both get here. Re-check now this row is in: of two that clash,
      // whichever reads last sees the other and backs out.
      const others = await loadBlockingBookings(now, { excludeId: booking.id });
      if (!isSlotFree(startAt, endAt, others, [], 0)) {
        console.warn(
          `[booking/request] ${booking.id} overlaps a booking made alongside it; backing out`,
        );
        await prisma.booking.delete({ where: { id: booking.id } });
        if (calendarEventId) await removeBookingEvent({ eventId: calendarEventId });
        return NextResponse.json(
          { ok: false, error: "This time slot is no longer available." },
          { status: 409 },
        );
      }

      // Best-effort contact upsert. The id feeds the redemption below, or a
      // per-customer promo limit would never bind.
      let redeemedByContactId: string | undefined;
      try {
        const { contact } = await findOrCreateContactByEmail(normalisedEmail, {
          name: cleanName,
          phone: phoneE164,
          address: canonicalAddress,
        });
        redeemedByContactId = contact.id;
        await syncContactToGoogle(contact.id);
      } catch (contactError) {
        console.error("[booking/request] Failed to upsert contact:", contactError);
      }

      // An unticked mailing-list box opts them out. A ticked one changes nothing, so an
      // earlier unsubscribe still stands.
      if (mailingList === false) {
        try {
          if (redeemedByContactId) await optOutContact(redeemedByContactId, "booking_form");
          else await optOutByEmail(normalisedEmail, "booking_form");
        } catch (optOutError) {
          console.error(
            "[booking/request] Failed to record the mailing-list opt-out:",
            optOutError,
          );
        }
      }

      // Awaited: Vercel freezes the instance after the response. Never throws.
      if (booking.promoIdAtBooking) {
        await recordPromoRedemption({
          promoId: booking.promoIdAtBooking,
          bookingId: booking.id,
          contactId: redeemedByContactId,
          // The realised discount is not known until the job is invoiced.
          discountValue: null,
        });
      }

      // Send before returning, or Vercel kills the function; helpers never throw.
      const { comms } = settings;
      await Promise.all([
        sendOwnerBookingNotification({
          id: booking.id,
          name: booking.name,
          email: booking.email,
          notes: booking.notes ?? "",
          startAt: booking.startAt,
          endAt: booking.endAt,
          cancelToken: booking.cancelToken,
          address: combineUnitAndAddress(booking.unit ?? "", booking.address ?? ""),
          meetingType: booking.meetingType,
          accessNotes: booking.accessNotes,
        }),
        ...(comms.pushOnBooking
          ? [
              sendOwnerPush({
                title: "New booking",
                // Name and time only - this renders on a lock screen.
                body: `${booking.name} - ${formatDateTimeShort(booking.startAt)}`,
                url: `/admin/bookings/${booking.id}`,
                tag: `booking-${booking.id}`,
              }),
            ]
          : []),
        ...(comms.notifyConfirmation
          ? [
              sendCustomerBookingConfirmation({
                id: booking.id,
                name: booking.name,
                email: booking.email,
                notes: booking.notes ?? "",
                startAt: booking.startAt,
                endAt: booking.endAt,
                cancelToken: booking.cancelToken,
                promoTitleAtBooking: booking.promoTitleAtBooking,
                promoWindowAtBooking: activePromo ? describeRecurringWindow(activePromo) : null,
                address: combineUnitAndAddress(booking.unit ?? "", booking.address ?? ""),
                meetingType: booking.meetingType,
                rescheduleCount: booking.rescheduleCount,
                accessNotes: booking.accessNotes,
              }),
            ]
          : []),
      ]);

      return NextResponse.json({
        ok: true,
        bookingId: booking.id,
        cancelToken: booking.cancelToken,
      });
    } catch (error) {
      // No booking row, so take the new event back off the calendar: no ghost invite.
      if (!bookingCreated && calendarEventId) {
        await removeBookingEvent({ eventId: calendarEventId });
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        console.warn("[booking/request] Concurrent booking conflict", {
          activeSlotKey: startAt.toISOString(),
          email: normalisedEmail,
          timestamp: new Date().toISOString(),
        });
        return NextResponse.json(
          { ok: false, error: "This time slot is no longer available." },
          { status: 409 },
        );
      }
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
