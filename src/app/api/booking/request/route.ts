// src/app/api/booking/request/route.ts
/**
 * @file route.ts
 * @description API route with duration support (1hr vs 2hr jobs).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import {
  validateBookingRequest,
  validateBookingPayloadFields,
  parseHourLabel,
  splitUnitFromAddress,
  type TimeOfDay,
  type StartMinute,
  type JobDuration,
  type ExistingBooking,
} from "@/features/booking/lib/booking";
import { getAvailabilityConfig } from "@/features/booking/lib/availability-config.server";
import { getSettings } from "@/shared/lib/settings/get-settings";
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
import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";
import { toE164NZ, isValidPhone } from "@/shared/lib/normalise-phone";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { getActivePromo } from "@/features/business/lib/promos";
import { lookupDriveDistance } from "@/features/business/lib/travel-distance";
import { lookupPublicHoliday } from "@/features/business/lib/pricing-policy.server";

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
    } = body;

    if (idempotencyKey) {
      console.log(`[booking/request] idempotencyKey=${idempotencyKey}`);
    }

    // Normalise + validate phone up front so a malformed number is rejected
    // before any of the calendar / DB work runs.
    const phoneE164 = phone ? toE164NZ(phone) || null : null;
    if (phone && (!phoneE164 || !isValidPhone(phoneE164))) {
      return NextResponse.json(
        { ok: false, error: "Please enter a valid phone number, or leave it blank." },
        { status: 400 },
      );
    }

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
      return NextResponse.json({ ok: false, error: payloadCheck.error }, { status: 400 });
    }

    const now = new Date();
    const { config, acceptingBookings } = await getAvailabilityConfig();
    if (!acceptingBookings) {
      return NextResponse.json(
        { ok: false, error: "Online booking is currently paused." },
        { status: 400 },
      );
    }
    const maxDate = new Date(now.getTime() + config.maxAdvanceDays * 24 * 60 * 60 * 1000);

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
      config,
    );

    if (!validation.valid) {
      return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
    }

    // Resolve the slot from the (already-validated) hour label + live durations.
    const startHour = parseHourLabel(timeOfDay);
    if (startHour === null) {
      return NextResponse.json({ ok: false, error: "Invalid time or duration" }, { status: 400 });
    }
    const durationMinutes = duration === "short" ? config.durations.short : config.durations.long;

    // Calculate start/end times
    const [year, month, day] = dateKey.split("-").map(Number);

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
        ? timeOfDay
        : timeOfDay.replace(/(am|pm)$/i, `:${String(startMinute).padStart(2, "0")}$1`);
    const durationLabel = `${duration === "short" ? "Standard" : "Extended"} (${durationMinutes} min)`;
    bookingNotes += `[${timeLabel} - ${durationLabel}]\n`;
    bookingNotes += `Meeting type: ${meetingType === "in-person" ? "In-person" : "Remote"}\n`;
    if (meetingType === "in-person" && address) {
      bookingNotes += `Address: ${address.trim()}\n`;
    }
    // Create calendar event
    let calendarEventId: string | null = null;
    try {
      const cleanDurationLabel = `${duration === "short" ? "Standard" : "Extended"} ${durationMinutes} min`;
      const summary = `Tech Support: ${name.trim()} - ${cleanDurationLabel}`;
      const calendarResult = await createBookingEvent({
        summary,
        description: bookingNotes,
        startAt,
        endAt,
        timeZone: config.timeZone,
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

    // Snapshot rates + active promo + one-way travel time so the quoted
    // price survives later admin rate edits / promo expiry. Consumed by the
    // late-cancellation invoice helper + future "open invoice from booking".
    // Best-effort: failures degrade to null rather than blocking the booking.
    const [rates, activePromo] = await Promise.all([
      prisma.rateConfig.findMany().catch((err) => {
        console.warn("[booking/request] RateConfig snapshot fetch failed:", err);
        return [] as Awaited<ReturnType<typeof prisma.rateConfig.findMany>>;
      }),
      getActivePromo().catch((err) => {
        console.warn("[booking/request] active promo fetch failed:", err);
        return null;
      }),
    ]);
    const baseRow = rates.find((r) => r.ratePerHour !== null && r.isDefault) ?? null;
    const complexRow = rates.find((r) => r.label === "Complex") ?? null;
    const travelRow = rates.find((r) => r.unit === "travel-hour") ?? null;
    const baseRateAtBooking = baseRow?.ratePerHour ?? null;
    const complexRateAtBooking =
      baseRateAtBooking !== null && complexRow?.hourlyDelta != null
        ? Math.round((baseRateAtBooking + complexRow.hourlyDelta) * 100) / 100
        : null;
    const travelRatePerHourAtBooking = travelRow?.ratePerHour ?? null;

    // One-way drive time for in-person bookings; lets the late-cancel
    // handler bill travel without a re-lookup. Non-blocking on failure.
    let travelMinsAtBooking: number | null = null;
    if (meetingType === "in-person" && address && address.trim()) {
      try {
        const drive = await lookupDriveDistance(address.trim());
        if (drive.status === "ok") {
          travelMinsAtBooking = drive.data.durationMins;
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
          name: name.trim(),
          email: email.trim().toLowerCase(),
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
          address: address?.trim() ? splitUnitFromAddress(address.trim()).rest : null,
          unit: address?.trim() ? splitUnitFromAddress(address.trim()).unit || null : null,
          meetingType: meetingType === "in-person" ? "in_person" : "remote",
          duration,
          travelMinsAtBooking,
          // Rate snapshot locks in the quoted price against later admin edits.
          baseRateAtBooking,
          complexRateAtBooking,
          travelRatePerHourAtBooking,
          // Promo snapshot denormalised - survives Promo deletion before service.
          promoIdAtBooking: activePromo?.id ?? null,
          promoTitleAtBooking: activePromo?.title ?? null,
          promoFlatHourlyRateAtBooking: activePromo?.flatHourlyRate ?? null,
          promoPercentDiscountAtBooking: activePromo?.percentDiscount ?? null,
          publicHolidayName,
        },
      });

      console.log(`[booking/request] Created ${duration} booking: ${booking.id}`);

      // Upsert contact record - best effort, never fail the booking on write error
      try {
        const { contact } = await findOrCreateContactByEmail(email.trim().toLowerCase(), {
          name: name.trim(),
          phone: phoneE164,
          address: address?.trim() || null,
        });
        // Best-effort sync to Google Contacts - never fail the booking if it errors.
        await syncContactToGoogle(contact.id);
      } catch (contactError) {
        console.error("[booking/request] Failed to upsert contact:", contactError);
      }

      // Send confirmation emails before returning so Vercel doesn't kill the
      // function before the Resend requests complete. Both functions catch all
      // errors internally and never throw. The owner alert always fires; the
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
        }),
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
