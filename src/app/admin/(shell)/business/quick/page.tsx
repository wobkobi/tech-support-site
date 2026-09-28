// src/app/admin/(shell)/business/quick/page.tsx
// Quick price page for settling up on site: address plus start/end time in, one total out,
// for a customer paying cash or by bank transfer on the spot. Priced as a job done today,
// so the rates, promo and public-holiday uplift are resolved for now. Today's booking
// calendar is matched too: the job in progress (or `?eventId=`) prefills the address,
// times and frozen travel through the calculator's own buildEventPrefill.

import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import {
  QuickPriceView,
  type QuickEvent,
  type QuickPrefill,
} from "@/features/business/components/QuickPriceView";
import { buildEventPrefill } from "@/features/business/lib/event-prefill.server";
import { calcTravelCharge } from "@/features/business/lib/pricing-policy";
import { getPolicy, lookupPublicHoliday } from "@/features/business/lib/pricing-policy.server";
import { resolvePromo } from "@/features/business/lib/promos";
import { lookupDriveRoundTrip } from "@/features/business/lib/travel-distance";
import type { EventPrefill, RateConfig, TravelEntry } from "@/features/business/types/business";
import {
  getBookingCalendarId,
  getCachedScheduleEvents,
} from "@/features/calendar/lib/google-calendar";
import { requireAdminAuth } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import {
  NZ_TZ,
  addDaysToDateKey,
  dateKeyParts,
  nzDateKey,
  nzMidnightUtc,
  nzNowTime,
} from "@/shared/lib/timezone-utils";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quick price - Business",
  robots: { index: false, follow: false },
};

/** A job that starts this soon counts as the one being priced (arriving a little early). */
const EARLY_ARRIVAL_MS = 15 * 60_000;

/**
 * How long after an event's booked end the operator is still treated as on site. Inside
 * it the end time defaults to now (the job ran over or is only just being settled);
 * past it the booked end stands, since the job is being priced after the fact.
 */
const STILL_ON_SITE_MS = 90 * 60_000;

/** NZ-local HH:MM for the event rows. */
const NZ_HHMM = new Intl.DateTimeFormat("en-NZ", {
  timeZone: NZ_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Today's booking-calendar events, earliest first. Served from the 30s schedule cache
 * with day-aligned bounds, so repeat opens stay warm. Never throws: a calendar outage
 * just leaves the page as a plain form.
 * @param now - Reference instant.
 * @returns Today's events with their raw ISO bounds.
 */
async function loadTodayEvents(
  now: Date,
): Promise<{ id: string; summary: string; start: string; end: string }[]> {
  const todayKey = nzDateKey(now);
  const [y, m, d] = dateKeyParts(todayKey);
  const [ty, tm, td] = dateKeyParts(addDaysToDateKey(todayKey, 1));
  try {
    const bookingCalId = getBookingCalendarId();
    const all = await getCachedScheduleEvents(
      nzMidnightUtc(y, m, d).toISOString(),
      nzMidnightUtc(ty, tm, td).toISOString(),
    );
    return all
      .filter((e) => e.calendarEmail === bookingCalId && nzDateKey(new Date(e.start)) === todayKey)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((e) => ({ id: e.id, summary: e.summary ?? "(no title)", start: e.start, end: e.end }));
  } catch (err) {
    console.error("[quick-price] could not load today's events:", err);
    return [];
  }
}

/**
 * Picks the event the operator is most likely standing in: the latest one that has
 * started (allowing an early arrival), so a job in progress beats the morning's
 * finished one. Later jobs today are never auto-picked.
 * @param events - Today's events, earliest first.
 * @param now - Reference instant.
 * @returns The matched event id, or null when nothing has started yet.
 */
function autoMatch(events: { id: string; start: string }[], now: Date): string | null {
  const started = events.filter(
    (e) => new Date(e.start).getTime() <= now.getTime() + EARLY_ARRIVAL_MS,
  );
  return started[started.length - 1]?.id ?? null;
}

/**
 * Travel for the matched event. Frozen drive minutes (TravelBlock or booking snapshot)
 * win, exactly as the calculator seeds them; with none on file the address is looked up
 * at the event's own times.
 * @param prefill - The matched event's prefill.
 * @param start - Event start instant.
 * @param end - Event end instant.
 * @param travelRatePerHour - Live travel rate.
 * @param minTravelCharge - Live travel minimum.
 * @returns The auto travel entry, or null when no drive is known.
 */
async function travelForPrefill(
  prefill: EventPrefill,
  start: Date,
  end: Date,
  travelRatePerHour: number,
  minTravelCharge: number,
): Promise<TravelEntry | null> {
  let there = prefill.travelMinsThere ?? 0;
  let back = prefill.travelMinsBack ?? there;
  let distanceKm: number | undefined;
  if (there <= 0 && prefill.jobAddress) {
    const result = await lookupDriveRoundTrip(prefill.jobAddress, start, end);
    if (result.status !== "ok") return null;
    there = result.data.there.durationMins;
    back = result.data.back.durationMins;
    distanceKm = result.data.there.distanceKm;
  }
  if (there <= 0) return null;
  const label = prefill.jobAddress || `${there} min drive`;
  return {
    label,
    cost: calcTravelCharge(there, back, travelRatePerHour, minTravelCharge),
    isAuto: true,
    destination: label,
    durationMinsOneWay: there,
    durationMinsBack: back,
    distanceKmOneWay: distanceKm,
  };
}

/**
 * Quick price page: resolves today's pricing context and calendar match server-side
 * and hands them to the client view.
 * @param props - Page props.
 * @param props.searchParams - Optional `eventId` to price a specific event, or "none" for a blank form.
 * @returns Quick price page element.
 */
export default async function QuickPricePage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth();
  const { eventId: requested } = await searchParams;
  const now = new Date();
  const [identity, policy, rateRows, promo, holiday, todayEvents] = await Promise.all([
    getIdentity(),
    getPolicy(),
    prisma.rateConfig.findMany({ orderBy: { label: "asc" } }),
    // Automatic promo only: there is no customer or code to judge limits against.
    resolvePromo({ at: now }).catch(() => null),
    lookupPublicHoliday(now).catch(() => null),
    loadTodayEvents(now),
  ]);

  // An explicit pick wins; "none" is the operator clearing the match.
  const matchedId = requested === "none" ? null : (requested ?? autoMatch(todayEvents, now));
  const eventPrefill = matchedId ? await buildEventPrefill([matchedId]).catch(() => null) : null;
  const slot = eventPrefill?.slots[0];
  const matched = todayEvents.find((e) => e.id === matchedId);

  let prefill: QuickPrefill | null = null;
  if (eventPrefill && slot) {
    // Live event bounds when today's list has it; a picked event from another day
    // falls back to its prefill slot, which is enough to price it.
    const startAt = matched ? new Date(matched.start) : now;
    const endAt = matched ? new Date(matched.end) : now;
    const onSite =
      !!matched &&
      now.getTime() >= startAt.getTime() - EARLY_ARRIVAL_MS &&
      now.getTime() <= endAt.getTime() + STILL_ON_SITE_MS;
    prefill = {
      eventId: eventPrefill.calendarEventId,
      summary: slot.summary,
      clientName: eventPrefill.clientName,
      address: eventPrefill.jobAddress,
      start: slot.startTime,
      end: onSite ? nzNowTime() : slot.endTime,
      bookedEnd: slot.endTime,
      travel: await travelForPrefill(
        eventPrefill,
        startAt,
        endAt,
        policy.TRAVEL_RATE_PER_HOUR,
        policy.MIN_TRAVEL_CHARGE,
      ).catch(() => null),
    };
  }

  const events: QuickEvent[] = todayEvents.map((e) => ({
    id: e.id,
    summary: e.summary,
    start: NZ_HHMM.format(new Date(e.start)),
    end: NZ_HHMM.format(new Date(e.end)),
  }));

  const rates: RateConfig[] = rateRows.map((r) => ({
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

  return (
    <>
      <PageHeader
        title="Quick price"
        description="Address and time in, a total to take by cash or bank transfer."
      />
      {/* Keyed by the match so picking another event re-seeds the form's state. */}
      <QuickPriceView
        key={prefill?.eventId ?? "blank"}
        rates={rates}
        promo={promo}
        holidayName={holiday?.name ?? null}
        bankAccount={identity.bankAccount}
        initialEnd={nzNowTime()}
        events={events}
        prefill={prefill}
        pricing={{
          gstRegistered: policy.GST_REGISTERED,
          minTravelCharge: policy.MIN_TRAVEL_CHARGE,
          travelRatePerHour: policy.TRAVEL_RATE_PER_HOUR,
          minBillableMins: policy.MIN_BILLABLE_MINS,
          billingIncrementMins: policy.BILLING_INCREMENT_MINS,
          holidayUplift: holiday ? policy.PUBLIC_HOLIDAY_UPLIFT : 0,
        }}
      />
    </>
  );
}
