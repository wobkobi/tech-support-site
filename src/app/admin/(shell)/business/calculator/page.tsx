// src/app/admin/(shell)/business/calculator/page.tsx
/**
 * @description Job calculator page. Resolves business identity, pricing
 * policy, rate configs, task templates, and the active promo server-side in
 * one parallel pass, then hands them to {@link CalculatorView} for AI job
 * parsing and time-tracked quoting - only the slow Google Contacts picker
 * list is left to a client fetch. `?eventId=` (the schedule's "Bill in
 * calculator" action) prefills the job from that calendar event's corrected
 * times plus its booking's client details, and links the saved invoice back
 * to both.
 */
import { CalculatorView, type EventPrefill } from "@/features/business/components/CalculatorView";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { getActivePromo } from "@/features/business/lib/promos";
import type { RateConfig, TaskTemplate } from "@/features/business/types/business";
import { fetchBookingEvent } from "@/features/calendar/lib/google-calendar";
import { requireAdminAuth } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import type React from "react";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Calculator - Business",
  robots: { index: false, follow: false },
};

/**
 * Formats an ISO timestamp in a Pacific/Auckland part set.
 * @param iso - ISO timestamp.
 * @param options - Intl date/time part options.
 * @returns Formatted NZ-local string.
 */
function formatNz(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland", ...options }).format(
    new Date(iso),
  );
}

/**
 * Builds the calculator prefill for a booking-calendar event: the event's
 * (operator-corrected) times as NZ-local date + HH:MM, plus client details
 * from the matching Booking row when one exists. Live event fetch - a just
 * saved time correction must be reflected, not the 60s schedule cache.
 * @param eventId - Google Calendar event id from the schedule deep-link.
 * @returns Prefill object, or null when the event is missing/unbillable.
 */
async function buildEventPrefill(eventId: string): Promise<EventPrefill | null> {
  const event = await fetchBookingEvent(eventId);
  if (!event) return null;

  const [booking, travelBlock] = await Promise.all([
    prisma.booking
      .findFirst({
        where: { calendarEventId: eventId },
        select: {
          id: true,
          name: true,
          email: true,
          address: true,
          unit: true,
          travelMinsAtBooking: true,
          travelMinsBackAtBooking: true,
        },
      })
      .catch(() => null),
    // Frozen drive prediction for the event's actual window. Raw minutes, not
    // rounded - the rounding carries the scheduling buffer, which pads the
    // calendar but must not be billed.
    prisma.travelBlock
      .findFirst({
        where: { sourceEventId: eventId },
        select: { rawTravelMinutes: true, rawTravelBackMinutes: true },
      })
      .catch(() => null),
  ]);

  // Booking snapshots are only trusted when they carry a back leg - that
  // field exists only since the traffic-aware two-leg change, so one-way-only
  // snapshots are free-flow-era quotes that would bill as if there were no
  // traffic. Without a usable prediction the travel card starts empty and the
  // operator's Look up quotes traffic at the job's wall-clock times.
  const snapshotIsTrafficAware = booking?.travelMinsBackAtBooking != null;
  const travelMinsThere =
    travelBlock?.rawTravelMinutes ??
    (snapshotIsTrafficAware ? (booking?.travelMinsAtBooking ?? null) : null);
  const travelMinsBack =
    travelBlock?.rawTravelBackMinutes ??
    (snapshotIsTrafficAware ? (booking?.travelMinsBackAtBooking ?? null) : null);

  return {
    calendarEventId: eventId,
    bookingId: booking?.id ?? null,
    jobDate: formatNz(event.start, { year: "numeric", month: "2-digit", day: "2-digit" }),
    startTime: formatNz(event.start, { hour: "2-digit", minute: "2-digit", hour12: false }),
    endTime: formatNz(event.end, { hour: "2-digit", minute: "2-digit", hour12: false }),
    clientName: booking?.name ?? event.summary ?? "",
    clientEmail: booking?.email ?? "",
    jobAddress:
      (booking?.address
        ? [booking.unit, booking.address].filter(Boolean).join("/")
        : event.location) ?? "",
    travelMinsThere,
    travelMinsBack,
  };
}

/**
 * Job calculator page with AI parsing, time tracking, and rate management.
 * @param props - Page props.
 * @param props.searchParams - Optional `eventId` from the schedule's "Bill in calculator" action.
 * @returns Calculator page element
 */
export default async function CalculatorPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const { eventId } = await searchParams;
  const [identity, policy, rateRows, templateRows, promo, eventPrefill] = await Promise.all([
    getIdentity(),
    getPolicy(),
    // Full rows (ids included) - the calculator's rate panel edits by id, so
    // the trimmed public cache from getRateRows is not enough here.
    prisma.rateConfig.findMany({ orderBy: { label: "asc" } }),
    prisma.taskTemplate.findMany({ orderBy: [{ usageCount: "desc" }, { description: "asc" }] }),
    getActivePromo(),
    // Bad/stale ids degrade to a normal calculator load.
    eventId ? buildEventPrefill(eventId) : Promise.resolve(null),
  ]);
  const pricing = {
    gstRegistered: policy.GST_REGISTERED,
    minTravelCharge: policy.MIN_TRAVEL_CHARGE,
  };

  // Flatten Dates to the ISO strings the client types expect (matches what
  // the JSON API routes previously returned).
  const initialRates: RateConfig[] = rateRows.map((r) => ({
    id: r.id,
    label: r.label,
    ratePerHour: r.ratePerHour,
    flatRate: r.flatRate,
    hourlyDelta: r.hourlyDelta,
    percentDelta: r.percentDelta,
    unit: r.unit,
    isDefault: r.isDefault,
    createdAt: r.createdAt.toISOString(),
  }));
  const initialTaskTemplates: TaskTemplate[] = templateRows.map((t) => ({
    id: t.id,
    description: t.description,
    defaultPrice: t.defaultPrice,
    usageCount: t.usageCount,
    device: t.device,
    action: t.action,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }));

  return (
    <>
      <h1 className="mb-6 text-2xl font-extrabold text-russian-violet">Job calculator</h1>
      <Suspense>
        <CalculatorView
          identity={identity}
          pricing={pricing}
          initialRates={initialRates}
          initialTaskTemplates={initialTaskTemplates}
          initialPromo={promo}
          eventPrefill={eventPrefill}
        />
      </Suspense>
    </>
  );
}
