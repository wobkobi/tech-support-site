// src/app/api/booking/request/route.ts
/**
 * @description API route with duration support (1hr vs 2hr jobs).
 */

import { getAvailabilityConfig } from "@/features/booking/lib/availability-config.server";
import {
  buildAppointmentDescription,
  combineUnitAndAddress,
  parseHourLabel,
  splitUnitFromAddress,
  validateBookingPayloadFields,
  validateBookingRequest,
  type JobDuration,
  type StartMinute,
  type TimeOfDay,
} from "@/features/booking/lib/booking";
import { loadBlockingBookings } from "@/features/booking/lib/existing-bookings.server";
import { formatQuotedRange } from "@/features/business/lib/estimate-range";
import { lookupPublicHoliday } from "@/features/business/lib/pricing-policy.server";
import { recordPromoRedemption } from "@/features/business/lib/promo-redemption";
import { resolvePromo } from "@/features/business/lib/promos";
import { lookupDriveRoundTrip } from "@/features/business/lib/travel-distance";
import { parseObjectId } from "@/features/business/lib/validation";
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
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { normaliseName } from "@/shared/lib/normalise-name";
import { validatePhone } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";
import { nzWallClockUtc } from "@/shared/lib/timezone-utils";
import { Prisma, type AiEstimateCategory, type EstimateTask } from "@prisma/client";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

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
  /** Honeypot field - real users never fill this; bots usually do. */
  website?: string;
  /**
   * Client-generated UUID; one per form mount. Logged for traceability so a
   * retried request after a flaky network can be correlated with the original.
   * The DB unique constraint on `activeSlotKey` is what actually prevents a
   * double-booking; this is just observability + a hook for future replay-safe
   * idempotency.
   */
  idempotencyKey?: string;
  /** Id of the PriceEstimateLog the customer saw before booking, if any. */
  estimateId?: string;
  /**
   * Promo code the customer entered, if any. Never trusted: the route
   * re-resolves it and prices from the result.
   */
  promoCode?: string;
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
      website,
      idempotencyKey,
      estimateId,
      promoCode,
    } = body;

    if (idempotencyKey) {
      console.log(`[booking/request] idempotencyKey=${idempotencyKey}`);
    }

    // Normalise + validate phone up front so a malformed number (letters,
    // wrong length) is rejected before any of the calendar / DB work runs.
    const phoneValidation = validatePhone(phone ?? "");
    if (phoneValidation.result === "invalid") {
      return NextResponse.json(
        { ok: false, error: "Please enter a valid phone number, or leave it blank." },
        { status: 400 },
      );
    }
    const phoneE164 = phoneValidation.e164 || null;

    // Honeypot trip: silently report success without creating a booking so the
    // bot moves on. Real users never fill this field (it's visually hidden
    // and tab-skipped on the form).
    if (typeof website === "string" && website.trim().length > 0) {
      console.warn("[booking/request] Honeypot tripped; faking success.", {
        ip: request.headers.get("x-forwarded-for") ?? "unknown",
      });
      return NextResponse.json({ ok: true });
    }

    const payloadCheck = validateBookingPayloadFields(
      { name, email, notes, dateKey, timeOfDay, duration, meetingType, address, phone },
      { requireEmail: true },
    );
    if (!payloadCheck.valid) {
      return errorResponse(payloadCheck.error, 400);
    }

    // normaliseAddress only formats an UNAMBIGUOUS match (null on 0 or >1 candidates), so
    // it never guesses between streets - real ambiguity was resolved by the customer's
    // pick on the client. Falls back to the typed value so a new address still books.
    const cleanName = normaliseName(name) || name.trim();
    const normalisedEmail = normaliseEmail(email);
    const canonicalAddress =
      meetingType === "in-person" && address?.trim()
        ? ((await normaliseAddress(address.trim())) ?? address.trim())
        : (address?.trim() ?? null);

    const now = new Date();
    const { config, acceptingBookings } = await getAvailabilityConfig();
    if (!acceptingBookings) {
      return NextResponse.json(
        { ok: false, error: "Online booking is currently paused." },
        { status: 400 },
      );
    }
    const maxDate = new Date(now.getTime() + config.maxAdvanceDays * 24 * 60 * 60 * 1000);

    const existingForValidation = await loadBlockingBookings(now);

    // Fail closed: the live calendar read is authoritative for real events, so
    // if it errors we cannot rule out a collision - refuse the booking rather
    // than risk a double-book against a manual calendar entry.
    let calendarEvents: Array<{ id: string; start: string; end: string }>;
    try {
      const rawEvents = await fetchAllCalendarEvents(now, maxDate);
      calendarEvents = rawEvents.map((e) => ({
        id: e.id,
        start: e.start,
        end: e.end,
      }));
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

    // Validate with duration
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

    // Calculate start/end times
    const [year, month, day] = dateKey.split("-").map(Number);

    const startAt = nzWallClockUtc(year, month, day, startHour, startMinute);
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);

    const cancelToken = randomUUID();
    const reviewToken = randomUUID();

    // Snapshot the quote the customer saw, before the notes/calendar are built so it
    // lands in both. Best effort, and every field is copied rather than referenced so it
    // survives the estimate-log retention purge. priceLow/priceHigh are the all-in total.
    let priceEstimateIdAtBooking: string | null = null;
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
        priceEstimateIdAtBooking = est.id;
        quotedLowAtBooking = est.priceLow;
        quotedHighAtBooking = est.priceHigh;
        quotedTravelAtBooking = est.travelCharge;
        quotedDescriptionAtBooking = est.description;
        quotedMinsAtBooking = est.aiEstimatedMins;
        quotedCategoryAtBooking = est.aiCategory;
        quotedTasksAtBooking = est.aiTasks;
      }
    }

    // Build notes
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
      // Same helper the admin price-snapshot card uses, so the notes line and
      // the card can never disagree on the labour/travel split.
      bookingNotes += `Quoted: ${formatQuotedRange(quotedLowAtBooking, quotedHighAtBooking, quotedTravelAtBooking)}\n`;
    }

    // The notes blob above is the internal record parseBookingNotes reads back. The
    // customer is an attendee on the event, so the invite gets the customer-facing
    // description instead - it must never carry the quoted price or the metadata.
    const identity = await getIdentity();
    const siteUrl = getSiteUrl();
    const calendarDescription = buildAppointmentDescription({
      company: identity.company,
      phone: identity.phone,
      email: identity.email,
      isRemote: meetingType === "remote",
      userNotes: notes.trim(),
      manageUrl: `${siteUrl}/booking/edit?token=${encodeURIComponent(cancelToken)}`,
      cancelUrl: `${siteUrl}/booking/cancel?token=${encodeURIComponent(cancelToken)}`,
    });

    // Create calendar event
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

    // Snapshot rates + active promo + one-way travel so the quoted price survives later
    // rate edits and promo expiry. Read by the late-cancellation invoice helper.
    // Best-effort: failures degrade to null rather than blocking the booking.
    //
    // The submitted code is re-resolved here rather than believed. A client can
    // post any string; resolvePromo decides what it actually unlocks, and an
    // unrecognised code silently falls back to the automatic promo. Resolved
    // against startAt, not now, so a booking made today for a job next month is
    // priced by the promo that will be running on the day.
    //
    // The email goes with it so per-customer and new-customer limits bind a
    // public booking, which has no Contact row yet.
    const [rates, activePromo] = await Promise.all([
      prisma.rateConfig.findMany().catch((err) => {
        console.warn("[booking/request] RateConfig snapshot fetch failed:", err);
        return [] as Awaited<ReturnType<typeof prisma.rateConfig.findMany>>;
      }),
      resolvePromo({ at: startAt, code: promoCode, email }).catch((err) => {
        console.warn("[booking/request] promo resolution failed:", err);
        return null;
      }),
    ]);
    const baseRow = rates.find((r) => r.ratePerHour !== null && r.isDefault) ?? null;
    const baseRateAtBooking = baseRow?.ratePerHour ?? null;
    // Travel rate is a pricing setting; snapshot it so later settings edits
    // can't reprice an already-quoted booking.
    const travelRatePerHourAtBooking = (await getSettings()).pricing.travelRatePerHour;

    // Drive-time snapshot for in-person bookings: outbound quoted at the start, return at
    // the end, so both are real traffic predictions for the actual drives. Lets the
    // late-cancel handler bill travel without a re-lookup. Non-blocking on failure.
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
        console.warn("[booking/request] travel-time snapshot failed:", err);
      }
    }

    // Stamp the public holiday name when the booking date is a stat day so
    // disputes can quote the exact holiday that drove the uplift.
    const holiday = await lookupPublicHoliday(startAt).catch((err) => {
      console.warn("[booking/request] public-holiday lookup failed:", err);
      return null;
    });
    const publicHolidayName = holiday?.name ?? null;

    // Create booking
    try {
      const booking = await prisma.booking.create({
        data: {
          name: cleanName,
          email: normalisedEmail,
          phone: phoneE164,
          notes: bookingNotes,
          startAt,
          endAt,
          status: "confirmed",
          cancelToken,
          reviewToken,
          calendarEventId,
          activeSlotKey: startAt.toISOString(), // Unique constraint for double-booking prevention
          bufferBeforeMin: 0,
          bufferAfterMin: config.bookingBufferAfterMin,
          // Notes text above stays dual-written for regex-parsing admin code.
          // Split unit off the address so apartment numbers can be filtered
          // without re-parsing.
          address: canonicalAddress ? splitUnitFromAddress(canonicalAddress).rest : null,
          unit: canonicalAddress ? splitUnitFromAddress(canonicalAddress).unit || null : null,
          meetingType: meetingType === "in-person" ? "in_person" : "remote",
          duration,
          travelMinsAtBooking,
          travelMinsBackAtBooking,
          // Rate snapshot locks in the quoted price against later admin edits.
          // complexRateAtBooking is no longer written (the Complex tier was
          // removed); the column stays for historical bookings.
          baseRateAtBooking,
          travelRatePerHourAtBooking,
          // Promo snapshot denormalised - survives Promo deletion before service.
          promoIdAtBooking: activePromo?.id ?? null,
          promoTitleAtBooking: activePromo?.title ?? null,
          promoFlatHourlyRateAtBooking: activePromo?.flatHourlyRate ?? null,
          promoPercentDiscountAtBooking: activePromo?.percentDiscount ?? null,
          publicHolidayName,
          // Snapshot of the public quote the customer saw before booking, plus
          // what they typed to get it and how the AI read it.
          priceEstimateIdAtBooking,
          quotedLowAtBooking,
          quotedHighAtBooking,
          quotedTravelAtBooking,
          quotedDescriptionAtBooking,
          quotedMinsAtBooking,
          quotedCategoryAtBooking,
          quotedTasksAtBooking,
        },
      });

      console.log(`[booking/request] Created ${duration} booking: ${booking.id}`);

      // Upsert contact record - best effort, never fail the booking on write error
      try {
        const { contact } = await findOrCreateContactByEmail(normalisedEmail, {
          name: cleanName,
          phone: phoneE164,
          address: canonicalAddress,
        });
        // Best-effort sync to Google Contacts - never fail the booking if it errors.
        await syncContactToGoogle(contact.id);
      } catch (contactError) {
        console.error("[booking/request] Failed to upsert contact:", contactError);
      }

      // Awaited, not detached: Vercel freezes the instance once the response is
      // sent. The helper swallows its own errors - a booking must not fail
      // because analytics bookkeeping did.
      if (booking.promoIdAtBooking) {
        await recordPromoRedemption({
          promoId: booking.promoIdAtBooking,
          bookingId: booking.id,
          // The realised discount is not known until the job is invoiced.
          discountValue: null,
        });
      }

      // Send before returning, or Vercel kills the function mid-request; both helpers
      // swallow their own errors and never throw. The owner alert always fires, the
      // customer confirmation honours the notifyConfirmation setting.
      const { comms } = await getSettings();
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
                address: combineUnitAndAddress(booking.unit ?? "", booking.address ?? ""),
                meetingType: booking.meetingType,
                rescheduleCount: booking.rescheduleCount,
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
      // Handle unique constraint violation (concurrent booking for same slot)
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        console.warn("[booking/request] Concurrent booking conflict", {
          activeSlotKey: startAt.toISOString(),
          email: normalisedEmail,
          timestamp: new Date().toISOString(),
        });
        // The booking lost the slot race, so the calendar event created above
        // is an orphan that already emailed the customer an invite. Best-effort
        // delete it so no ghost event/invite lingers at the taken time.
        if (calendarEventId) {
          await deleteBookingEvent({ eventId: calendarEventId }).catch((err) =>
            console.error("[booking/request] Failed to delete orphaned calendar event:", err),
          );
        }
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
