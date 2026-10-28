// src/app/admin/(shell)/business/quick/page.tsx
// Quick price page for settling up on site: address and times in, one total out, priced at
// the job's start. The job in progress (or `?eventId=`) prefills via buildEventPrefill.

import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import {
  QuickPriceView,
  type QuickEvent,
  type QuickPrefill,
} from "@/features/business/components/QuickPriceView";
import { buildEventPrefill } from "@/features/business/lib/event-prefill.server";
import { calcTravelCharge, dateSurcharge } from "@/features/business/lib/pricing-policy";
import { getPolicy, lookupPublicHoliday } from "@/features/business/lib/pricing-policy.server";
import { promoForJob } from "@/features/business/lib/promos";
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
  nzMinuteOfDay,
  nzNowTime,
  nzWallClockUtc,
  nzWeekday,
  timeParts,
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
 * How long after an event's booked end the end time still defaults to now.
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
 * Today's booking-calendar jobs, earliest first, from the schedule cache. An all-day block
 * isn't a job, and starting at midnight it would otherwise auto-match. Never throws.
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
      .filter(
        (e) =>
          e.calendarEmail === bookingCalId &&
          !e.allDay &&
          nzDateKey(new Date(e.start)) === todayKey,
      )
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((e) => ({ id: e.id, summary: e.summary ?? "(no title)", start: e.start, end: e.end }));
  } catch (err) {
    console.error("[quick-price] could not load today's events:", err);
    return [];
  }
}

/**
 * Picks the latest event that has started (allowing an early arrival); later jobs never.
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
 * Travel for the matched event: frozen drive minutes win, else a lookup at the event's times.
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
  // A walked job with no drive on record bills no trip rather than a fresh drive lookup.
  if (there <= 0 && prefill.jobAddress && !prefill.walked) {
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
 * When the job's holiday, weekday and promo are judged: the matched event's live start, else
 * the prefill's own date and start, else now for a blank form.
 * @param matchedStart - ISO start of the event matched in today's list, if any.
 * @param slot - The prefill's first slot, if any.
 * @param slot.date - NZ-local YYYY-MM-DD.
 * @param slot.startTime - NZ-local HH:MM start.
 * @param now - Reference instant.
 * @returns The instant to price at.
 */
function jobStartAt(
  matchedStart: string | undefined,
  slot: { date: string; startTime: string } | undefined,
  now: Date,
): Date {
  if (matchedStart) return new Date(matchedStart);
  if (!slot) return now;
  const [year, month, day] = dateKeyParts(slot.date);
  const [hour, minute] = timeParts(slot.startTime);
  const at = nzWallClockUtc(year, month, day, hour, minute);
  return Number.isNaN(at.getTime()) ? now : at;
}

/**
 * Quick price page: resolves the job's pricing and today's calendar match for the client view.
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
  const [identity, policy, rateRows, todayEvents] = await Promise.all([
    getIdentity(),
    getPolicy(),
    prisma.rateConfig.findMany({ orderBy: { label: "asc" } }),
    loadTodayEvents(now),
  ]);

  // An explicit pick wins; "none" is the operator clearing the match.
  const matchedId = requested === "none" ? null : (requested ?? autoMatch(todayEvents, now));
  const eventPrefill = matchedId ? await buildEventPrefill([matchedId]).catch(() => null) : null;
  const slot = eventPrefill?.slots[0];
  const matched = todayEvents.find((e) => e.id === matchedId);
  // Priced at the job's start, so a job settled after midnight or picked from another day
  // keeps its own date's surcharge and promo.
  const jobStart = jobStartAt(matched?.start, slot, now);
  // Same rule as the calculator: a booking keeps its locked-in promo, a phone-made job takes
  // the promo running when its event was made, and a blank form takes today's.
  const [holiday, promo] = await Promise.all([
    lookupPublicHoliday(jobStart).catch(() => null),
    promoForJob({
      at: jobStart,
      bookingId: eventPrefill?.bookingId,
      bookedAt: eventPrefill?.bookedAt,
      email: eventPrefill?.clientEmail || null,
    }).catch(() => null),
  ]);

  let prefill: QuickPrefill | null = null;
  if (eventPrefill && slot) {
    // Live event bounds when listed today, else the prefill slot.
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
      bookedAt: eventPrefill.bookedAt,
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
        surcharge={dateSurcharge(
          holiday?.name ?? null,
          nzWeekday(jobStart),
          {
            publicHolidayUplift: policy.PUBLIC_HOLIDAY_UPLIFT,
            weekendUplift: policy.WEEKEND_UPLIFT,
            afterHoursFromHour: policy.AFTER_HOURS_FROM_HOUR,
          },
          // A blank form prices at now, which says nothing about when the job started.
          matched || slot ? nzMinuteOfDay(jobStart) : null,
        )}
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
          unsuccessfulFactor: policy.UNSUCCESSFUL_WORK_FACTOR,
          weekendUplift: policy.WEEKEND_UPLIFT,
        }}
      />
    </>
  );
}
