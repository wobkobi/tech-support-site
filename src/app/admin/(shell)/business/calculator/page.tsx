// src/app/admin/(shell)/business/calculator/page.tsx
/**
 * @description Job calculator page. Resolves business identity, pricing
 * policy, rate configs, task templates, and the active promo server-side in
 * one parallel pass, then hands them to {@link CalculatorView} for AI job
 * parsing and time-tracked quoting - only the slow Google Contacts picker
 * list is left to a client fetch. `?eventId=` (the schedule's "Bill in
 * calculator" action) prefills the job from that calendar event's corrected
 * times plus its booking's client details, and links the saved invoice back
 * to both. `?eventIds=a,b,c` bills several of the day's events as one job,
 * each event keeping its own time slot so the gaps between them go unbilled.
 */
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import {
  CalculatorView,
  type EventPrefill,
  type EventPrefillSlot,
} from "@/features/business/components/CalculatorView";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { getActivePromo } from "@/features/business/lib/promos";
import type { RateConfig, TaskTemplate } from "@/features/business/types/business";
import { fetchBookingEvent } from "@/features/calendar/lib/google-calendar";
import { requireAdminAuth } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import { NZ_TZ } from "@/shared/lib/timezone-utils";
import type { Metadata } from "next";
import type React from "react";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Calculator - Business",
  robots: { index: false, follow: false },
};

/** Booking fields the prefill needs, shared by every merged event's lookup. */
const BOOKING_SELECT = {
  id: true,
  name: true,
  email: true,
  address: true,
  unit: true,
  meetingType: true,
  travelMinsAtBooking: true,
  travelMinsBackAtBooking: true,
} as const;

/**
 * Formats an ISO timestamp in a Pacific/Auckland part set.
 * @param iso - ISO timestamp.
 * @param options - Intl date/time part options.
 * @returns Formatted NZ-local string.
 */
function formatNz(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: NZ_TZ, ...options }).format(new Date(iso));
}

/** One resolved calendar event plus the records that back it. */
interface ResolvedEvent {
  id: string;
  start: string;
  end: string;
  summary: string | null;
  location: string | null;
  booking: {
    id: string;
    name: string;
    email: string;
    address: string | null;
    unit: string | null;
    meetingType: string | null;
    travelMinsAtBooking: number | null;
    travelMinsBackAtBooking: number | null;
  } | null;
  travelBlock: { rawTravelMinutes: number | null; rawTravelBackMinutes: number | null } | null;
}

/**
 * Loads one calendar event with its Booking row and frozen TravelBlock. Live
 * event fetch - a just-saved time correction must be reflected, not the 60s
 * schedule cache.
 * @param eventId - Google Calendar event id.
 * @returns The resolved event, or null when it is missing or unbillable.
 */
async function resolveEvent(eventId: string): Promise<ResolvedEvent | null> {
  const event = await fetchBookingEvent(eventId);
  if (!event) return null;

  const [booking, travelBlock] = await Promise.all([
    prisma.booking
      .findFirst({ where: { calendarEventId: eventId }, select: BOOKING_SELECT })
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

  return {
    id: eventId,
    start: event.start,
    end: event.end,
    summary: event.summary,
    location: event.location,
    booking,
    travelBlock,
  };
}

/**
 * Drive prediction for one event, preferring the frozen TravelBlock over the
 * booking snapshot. Booking snapshots are only trusted when they carry a back
 * leg - that field exists only since the traffic-aware two-leg change, so
 * one-way-only snapshots are free-flow-era quotes that would bill as if there
 * were no traffic.
 * @param resolved - The resolved event.
 * @returns There/back raw minutes; either may be null when nothing is known.
 */
function travelFor(resolved: ResolvedEvent): { there: number | null; back: number | null } {
  const snapshotIsTrafficAware = resolved.booking?.travelMinsBackAtBooking != null;
  return {
    there:
      resolved.travelBlock?.rawTravelMinutes ??
      (snapshotIsTrafficAware ? (resolved.booking?.travelMinsAtBooking ?? null) : null),
    back:
      resolved.travelBlock?.rawTravelBackMinutes ??
      (snapshotIsTrafficAware ? (resolved.booking?.travelMinsBackAtBooking ?? null) : null),
  };
}

/**
 * Flattens a calendar location or booking address to one line. Calendar
 * locations are often multi-line; `<input>` values strip newlines into
 * run-together text ("RoadEpsom"), so they are comma-joined instead.
 * @param resolved - The resolved event to read an address from.
 * @returns Single-line address, or an empty string when there is none.
 */
function addressOf(resolved: ResolvedEvent): string {
  const raw =
    (resolved.booking?.address
      ? [resolved.booking.unit, resolved.booking.address].filter(Boolean).join("/")
      : resolved.location) ?? "";
  return raw.replace(/,?\s*[\r\n]+\s*/g, ", ").trim();
}

/**
 * Builds the calculator prefill for one or more booking-calendar events. A
 * single id behaves exactly as before; several ids bill as one job, with each
 * event contributing its own time slot so the gaps between them are never
 * billed. Client details come from the earliest event that has a Booking row,
 * and travel is one round trip - out to the first event, home from the last -
 * because that is what the day actually cost.
 * @param eventIds - Google Calendar event ids, in any order.
 * @returns Prefill object, or null when no id resolves to a billable event.
 */
async function buildEventPrefill(eventIds: string[]): Promise<EventPrefill | null> {
  const resolved = (await Promise.all(eventIds.map(resolveEvent)))
    .filter((e): e is ResolvedEvent => e !== null)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (resolved.length === 0) return null;

  const first = resolved[0];
  const last = resolved[resolved.length - 1];
  // Client identity comes from the earliest event that actually has a booking:
  // a merged run can start with a bare calendar entry and still be the same
  // customer's job.
  const withBooking = resolved.find((e) => e.booking) ?? first;
  const booking = withBooking.booking;

  const slots: EventPrefillSlot[] = resolved.map((e) => ({
    calendarEventId: e.id,
    bookingId: e.booking?.id ?? null,
    startTime: formatNz(e.start, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    endTime: formatNz(e.end, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    summary: e.summary ?? "(no title)",
  }));

  // One round trip for the whole job: drive out for the first event, home
  // after the last. Hops between merged events are not billed - they are the
  // same trip, and the operator never charges twice for being in the area.
  const outbound = travelFor(first);
  const inbound = travelFor(last);

  return {
    calendarEventId: first.id,
    bookingId: booking?.id ?? null,
    jobDate: formatNz(first.start, { year: "numeric", month: "2-digit", day: "2-digit" }),
    slots,
    clientName: booking?.name ?? withBooking.summary ?? "",
    clientEmail: booking?.email ?? "",
    jobAddress: addressOf(withBooking) || addressOf(first),
    // Cancel mode bills no round trip on a remote session. Map the Prisma enum
    // to the hyphenated form the client side uses; null when no booking backs
    // the event, and the calculator falls back to inferring from the address.
    meetingType:
      booking?.meetingType === "remote"
        ? "remote"
        : booking?.meetingType === "in_person"
          ? "in-person"
          : null,
    travelMinsThere: outbound.there,
    travelMinsBack: inbound.back ?? outbound.back,
  };
}

/**
 * Parses the event deep-link params into a de-duplicated id list. `eventIds`
 * (comma-separated) carries a merged job; `eventId` is the schedule's
 * single-event action and stays supported on its own.
 * @param params - Resolved search params.
 * @param params.eventId - Single event id from the schedule action.
 * @param params.eventIds - Comma-separated ids from the calculator's merge picker.
 * @returns Event ids to prefill from, empty when neither param is present.
 */
function parseEventIds(params: { eventId?: string; eventIds?: string }): string[] {
  const raw = [...(params.eventIds?.split(",") ?? []), ...(params.eventId ? [params.eventId] : [])];
  return Array.from(new Set(raw.map((id) => id.trim()).filter(Boolean)));
}

/**
 * Job calculator page with AI parsing, time tracking, and rate management.
 * @param props - Page props.
 * @param props.searchParams - Optional `eventId` (schedule's "Bill in calculator") or `eventIds` (merged job).
 * @returns Calculator page element
 */
export default async function CalculatorPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string; eventIds?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const eventIds = parseEventIds(await searchParams);
  const [identity, policy, rateRows, templateRows, promo, eventPrefill] = await Promise.all([
    getIdentity(),
    getPolicy(),
    // Full rows (ids included) - the calculator's rate panel edits by id, so
    // the trimmed public cache from getRateRows is not enough here.
    prisma.rateConfig.findMany({ orderBy: { label: "asc" } }),
    prisma.taskTemplate.findMany({ orderBy: [{ usageCount: "desc" }, { description: "asc" }] }),
    getActivePromo(),
    // Bad/stale ids degrade to a normal calculator load.
    eventIds.length > 0 ? buildEventPrefill(eventIds) : Promise.resolve(null),
  ]);
  const pricing = {
    gstRegistered: policy.GST_REGISTERED,
    minTravelCharge: policy.MIN_TRAVEL_CHARGE,
    travelRatePerHour: policy.TRAVEL_RATE_PER_HOUR,
    minBillableMins: policy.MIN_BILLABLE_MINS,
    unsuccessfulFactor: policy.UNSUCCESSFUL_WORK_FACTOR,
    mergeSuggestGapMins: policy.MERGE_SUGGEST_GAP_MINS,
    taskTiming: {
      snapMins: policy.BILLING_INCREMENT_MINS,
      shortTaskMins: policy.SHORT_TASK_MINS,
      minTaskMins: policy.MIN_TASK_MINS,
    },
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
      <PageHeader
        title="Job calculator"
        description="Parse a job with AI or build it by hand, then save it as an invoice or income."
      />
      <Suspense>
        {/* Keyed by the event set so the in-page picker's client-side
            navigation remounts the view - the prefill lands via useState
            initialisers, which never re-run on a prop change alone. */}
        <CalculatorView
          key={eventIds.length > 0 ? eventIds.join(",") : "blank"}
          identity={identity}
          pricing={pricing}
          cancellation={policy.CANCELLATION}
          initialRates={initialRates}
          initialTaskTemplates={initialTaskTemplates}
          initialPromo={promo}
          eventPrefill={eventPrefill}
        />
      </Suspense>
    </>
  );
}
