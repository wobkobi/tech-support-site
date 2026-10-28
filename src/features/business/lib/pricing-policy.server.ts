// src/features/business/lib/pricing-policy.server.ts
// Server-only pricing helpers that need Prisma, kept out of the client-safe pricing-policy.ts.

import { hourLabel } from "@/features/booking/lib/booking";
import { formatMoneyCompact } from "@/features/business/lib/business-format";
import { remoteRateDelta } from "@/features/business/lib/estimate-range";
import {
  holidayTakenOn,
  offlineHoliday,
  type HolidayMatch,
} from "@/features/business/lib/holiday-calendar";
import { isBusinessModifier } from "@/features/business/lib/job-modifiers";
import {
  afterHoursSurcharge,
  dateSurcharge,
  FALLBACK_BASE_RATE,
  FALLBACK_BUSINESS_DELTA,
  GST_RATE,
  HOME_REGION,
  NZ_REGION,
  type DateSurcharge,
  type Policy,
} from "@/features/business/lib/pricing-policy";
import type { PublicRate } from "@/features/business/types/pricing";
import { roundCents } from "@/shared/lib/money";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { dateKeyParts, nzDateKey, weekdayOf } from "@/shared/lib/timezone-utils";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import "server-only";

/** Cache tag busted by every RateConfig write so rate edits go live immediately. */
export const RATE_CONFIG_TAG = "rate-config";

/**
 * RateConfig snapshot as cached. `updatedAt` is an ISO string so the shape survives
 * `unstable_cache`'s JSON round trip.
 */
export interface CachedRateRow {
  label: string;
  ratePerHour: number | null;
  flatRate: number | null;
  hourlyDelta: number | null;
  percentDelta: number | null;
  unit: string;
  isDefault: boolean;
  updatedAt: string | null;
}

/**
 * Cached RateConfig rows, busted via {@link RATE_CONFIG_TAG} on every admin write. No timed
 * revalidate: the root layout reads this, so a timer would become every page's ISR interval.
 * @returns Rate rows ordered by label, Dates flattened to ISO strings.
 */
export const getRateRows = unstable_cache(
  async (): Promise<CachedRateRow[]> => {
    const rows = await prisma.rateConfig.findMany({ orderBy: { label: "asc" } });
    return rows.map((r) => ({
      label: r.label,
      ratePerHour: r.ratePerHour,
      flatRate: r.flatRate,
      hourlyDelta: r.hourlyDelta,
      percentDelta: r.percentDelta,
      unit: r.unit,
      isDefault: r.isDefault,
      updatedAt: r.updatedAt ? r.updatedAt.toISOString() : null,
    }));
  },
  ["rate-config"],
  { tags: [RATE_CONFIG_TAG], revalidate: false },
);

/**
 * Live policy bundle from the settings panel, deduped per request. {@link GST_RATE} stays a
 * legislated constant; client code receives these values as props.
 * @returns The current policy values the operator has configured.
 */
export const getPolicy = cache(async (): Promise<Policy> => {
  const { pricing } = await getSettings();
  return {
    GST_REGISTERED: pricing.gstRegistered,
    GST_RATE,
    MIN_TRAVEL_CHARGE: pricing.minTravelCharge,
    TRAVEL_RATE_PER_HOUR: pricing.travelRatePerHour,
    MIN_BILLABLE_MINS: pricing.minBillableMins,
    BILLING_INCREMENT_MINS: pricing.billingIncrementMins,
    SHORT_TASK_MINS: pricing.shortTaskMins,
    MIN_TASK_MINS: pricing.minTaskMins,
    MAX_JOB_MINS: pricing.maxJobMins,
    PUBLIC_HOLIDAY_PER_HOUR: pricing.publicHolidayPerHour,
    WEEKEND_PER_HOUR: pricing.weekendPerHour,
    AFTER_HOURS_FROM_HOUR: pricing.afterHoursFromHour,
    UNSUCCESSFUL_WORK_FACTOR: pricing.unsuccessfulWorkFactor,
    NO_FIX_FREE_MINS: pricing.noFixFreeMins,
    WORKMANSHIP_WINDOW_DAYS: pricing.workmanshipWindowDays,
    MERGE_SUGGEST_GAP_MINS: pricing.mergeSuggestGapMins,
    CANCELLATION: pricing.cancellation,
  };
});

/** One labour modifier as rendered on the pricing page accordion. */
interface PublicModifier {
  label: string;
  /** Name shown to customers; differs from the rate label where the rate's own name misleads. */
  publicLabel: string;
  /**
   * A "delta" changes the task's own $/hr (a promo discounts it); an "uplift" is a surcharge
   * on full labour that a promo doesn't touch.
   */
  kind: "delta" | "uplift";
  /** Effective $/hr after applying the modifier to the base hourly rate. */
  effectiveRate: number;
  /** Customer-facing delta description (e.g. "+$20", "-$10", "+$25"). */
  deltaDescription: string;
  /** Brief context line shown beneath the rate (e.g. "data recovery, hardware repair"). */
  description: string;
}

/** Shape consumed by the pricing page. Built from the live RateConfig rows. */
export interface PublicPricing {
  /** Hourly rate (the `isDefault: true` Standard row, or first hourly row as fallback). */
  baseRate: number;
  /** Travel hourly rate, used for round-trip drive billing. */
  travelRatePerHour: number;
  /** Full remote hourly rate (base + Remote modifier delta). */
  remoteRate: number;
  /** Effective business hourly rate (base + Business modifier delta); shown on /business only. */
  businessRate: number;
  /** Business rate for a remote session (Business and Remote both apply). */
  businessRemoteRate: number;
  /** Customer-facing modifier list rendered in the Modifiers accordion. */
  modifiers: PublicModifier[];
  /** Most-recent updatedAt across all RateConfig rows; powers the "rates last updated" footer. */
  ratesUpdatedAt: Date | null;
}

/**
 * Customer-facing names for rate labels that read wrong on a public page. "At home" is
 * complex work taken back to the operator's place, but under "Home rates" a customer takes it
 * as their own home; Remote also covers phone help.
 */
const MODIFIER_PUBLIC_LABELS: Record<string, string> = {
  "At home": "Complex work at my place",
  Remote: "Remote or phone",
};

/** Per-label description shown under each modifier on the accordion. */
const MODIFIER_DESCRIPTIONS: Record<string, string> = {
  Remote: "I log in to your computer or talk you through it on the phone. Quick calls are free.",
  "At home":
    "Bigger jobs like data recovery or hardware repairs, where I take the device away and work on it here.",
  Weekend: "Applied automatically on Saturdays and Sundays (not on top of a holiday).",
};

/** $/hr modifiers customers can see; the rest (Business and any added later) stay admin-only. */
const PUBLIC_DELTA_LABELS = new Set(["Remote", "At home"]);

/**
 * The base hourly rate: the default hourly row, else the first hourly row.
 * @param rows - Rate rows.
 * @returns The rate, or null when no hourly row exists.
 */
function baseRateOf(rows: readonly CachedRateRow[]): number | null {
  return (
    rows.find((r) => r.ratePerHour !== null && r.isDefault)?.ratePerHour ??
    rows.find((r) => r.ratePerHour !== null && r.unit === "hour")?.ratePerHour ??
    null
  );
}

/**
 * Rate rows the public estimators may see: hourly rates and the modifiers the pricing page
 * lists. Admin-only modifiers (Business) and internal fields are dropped.
 * @param rows - Rate rows from {@link getRateRows}.
 * @returns Customer-safe rate rows.
 */
export function toPublicRates(rows: readonly CachedRateRow[]): PublicRate[] {
  return rows
    .filter(
      (r) =>
        r.unit === "hour" ||
        (r.unit === "modifier" && r.hourlyDelta !== null && PUBLIC_DELTA_LABELS.has(r.label)),
    )
    .map(({ label, ratePerHour, flatRate, hourlyDelta, unit, isDefault }) => ({
      label,
      ratePerHour,
      flatRate,
      hourlyDelta,
      unit,
      isDefault,
    }));
}

/**
 * Public pricing snapshot for the pricing + FAQ pages and the layout JSON-LD, from
 * {@link getRateRows} and settings, deduped per request.
 * @returns Live pricing snapshot.
 */
export const getPublicPricing = cache(async (): Promise<PublicPricing> => {
  const [rows, { pricing }] = await Promise.all([getRateRows(), getSettings()]);

  const baseRate = baseRateOf(rows) ?? FALLBACK_BASE_RATE;
  // Same Remote lookup the estimators use, so the remote figures here match their quotes.
  const remoteDelta = remoteRateDelta(rows, "remote");
  const remoteRate = roundCents(baseRate + remoteDelta);

  // A pricing setting, not a rate row, so the calculator's rate panel can't change it.
  const travelRatePerHour = pricing.travelRatePerHour;

  // Base + the Business row's delta; only /business shows it, not the accordion below.
  const businessDelta =
    rows.find((r) => isBusinessModifier(r) && r.unit === "modifier")?.hourlyDelta ??
    FALLBACK_BUSINESS_DELTA;
  const businessRate = roundCents(baseRate + businessDelta);
  const businessRemoteRate = roundCents(businessRate + remoteDelta);

  // Delivery channels are rate rows; the surcharges are flat $/hr pricing settings.
  const modifiers: PublicModifier[] = [];
  for (const row of rows) {
    if (row.unit !== "modifier") continue;
    if (PUBLIC_DELTA_LABELS.has(row.label) && row.hourlyDelta !== null) {
      modifiers.push({
        label: row.label,
        publicLabel: MODIFIER_PUBLIC_LABELS[row.label] ?? row.label,
        kind: "delta",
        effectiveRate: roundCents(baseRate + row.hourlyDelta),
        deltaDescription: row.hourlyDelta > 0 ? `+$${row.hourlyDelta}` : `-$${-row.hourlyDelta}`,
        description: MODIFIER_DESCRIPTIONS[row.label] ?? "",
      });
    }
  }
  /**
   * Adds one flat surcharge line, priced on the base rate for the accordion's "= $/hr".
   * @param label - Line label.
   * @param perHour - Surcharge in $/hr.
   * @param description - Context shown under the line.
   */
  const pushSurcharge = (label: string, perHour: number, description: string): void => {
    modifiers.push({
      label,
      publicLabel: label,
      kind: "uplift",
      effectiveRate: roundCents(baseRate + perHour),
      deltaDescription: `+${formatMoneyCompact(perHour)}`,
      description,
    });
  };
  if (pricing.weekendPerHour > 0) {
    pushSurcharge("Weekend", pricing.weekendPerHour, MODIFIER_DESCRIPTIONS.Weekend ?? "");
    // After hours bills the weekend amount from an hour that's a setting.
    if (pricing.afterHoursFromHour !== null) {
      pushSurcharge(
        "After hours",
        pricing.weekendPerHour,
        `Applied automatically to weekday visits starting from ${hourLabel(pricing.afterHoursFromHour)} (not on top of a weekend or holiday).`,
      );
    }
  }
  if (pricing.publicHolidayPerHour > 0) {
    pushSurcharge(
      "Public holiday",
      pricing.publicHolidayPerHour,
      "Applied automatically on every NZ public holiday, plus Christmas Eve and New Year's Eve. A public holiday on a weekend is charged on the weekday it's observed.",
    );
  }

  // Latest mtime for the "Rates last updated" footer; ISO strings compare lexicographically.
  const isoMax = rows.reduce<string | null>((max, r) => {
    if (!r.updatedAt) return max;
    if (!max) return r.updatedAt;
    return r.updatedAt > max ? r.updatedAt : max;
  }, null);

  return {
    baseRate,
    travelRatePerHour,
    remoteRate,
    businessRate,
    businessRemoteRate,
    modifiers,
    ratesUpdatedAt: isoMax ? new Date(isoMax) : null,
  };
});

/**
 * Looks up the NZ or home-region public holiday a date (NZ-local) bills, from the
 * `PublicHoliday` table, falling back to {@link offlineHoliday} when no row matches or the
 * table is unreachable. A weekend holiday taken on a later weekday ({@link holidayTakenOn})
 * bills there instead, so the date itself gets none and bills as a weekend.
 * @param d - Booking timestamp (UTC); compared against the NZ-local date key.
 * @returns `{ name, region }` of the holiday, or null.
 */
export async function lookupPublicHoliday(d: Date): Promise<HolidayMatch | null> {
  const key = nzDateKey(d);
  if (holidayTakenOn(key)) return null;
  try {
    const row = await prisma.publicHoliday.findFirst({
      where: { date: key, region: { in: [NZ_REGION, HOME_REGION] } },
      orderBy: { region: "asc" },
    });
    if (row) return { name: row.name, region: row.region };
  } catch (err) {
    console.warn("[pricing-policy] PublicHoliday lookup failed; using fallback:", err);
  }
  return offlineHoliday(key);
}

/**
 * Batch variant of {@link lookupPublicHoliday}: one table read for every key, with the
 * {@link offlineHoliday} fallback filling gaps.
 * @param keys - NZ-local YYYY-MM-DD date strings.
 * @param options - Lookup options.
 * @param options.keepMoved - Keep a weekend holiday taken on a later weekday, for a calendar
 * that names the day; pricing leaves it out so the date bills as a weekend.
 * @returns Map from date key to `{ name, region }`; non-holiday keys are absent.
 */
export async function lookupPublicHolidaysForKeys(
  keys: string[],
  options: { keepMoved?: boolean } = {},
): Promise<Map<string, HolidayMatch>> {
  const result = new Map<string, HolidayMatch>();
  if (keys.length === 0) return result;
  try {
    // region asc + first-row-wins per key replicates the per-key findFirst.
    const rows = await prisma.publicHoliday.findMany({
      where: { date: { in: keys }, region: { in: [NZ_REGION, HOME_REGION] } },
      orderBy: { region: "asc" },
    });
    for (const row of rows) {
      if (!result.has(row.date)) result.set(row.date, { name: row.name, region: row.region });
    }
  } catch (err) {
    console.warn("[pricing-policy] PublicHoliday range lookup failed; using fallback:", err);
  }
  for (const key of keys) {
    if (!options.keepMoved && holidayTakenOn(key)) {
      result.delete(key);
      continue;
    }
    if (result.has(key)) continue;
    const fallback = offlineHoliday(key);
    if (fallback) result.set(key, fallback);
  }
  return result;
}

/**
 * Attaches each booking day's labour surcharge via {@link dateSurcharge}, the same rule
 * invoices bill with. A weekday with none of its own also gets `afterHours`, which the slot
 * picker applies to starts from the after-hours hour.
 * @param days - Bookable days keyed by NZ-local date.
 * @returns The same days, each with `surcharge` and `afterHours` set (null when none applies).
 */
export async function withDateSurcharges<T extends { dateKey: string }>(
  days: T[],
): Promise<
  Array<
    T & {
      surcharge: DateSurcharge | null;
      afterHours: { fromHour: number; surcharge: DateSurcharge } | null;
    }
  >
> {
  const [policy, holidays] = await Promise.all([
    getPolicy(),
    lookupPublicHolidaysForKeys(days.map((d) => d.dateKey)),
  ]);
  const rules = {
    publicHolidayPerHour: policy.PUBLIC_HOLIDAY_PER_HOUR,
    weekendPerHour: policy.WEEKEND_PER_HOUR,
  };
  const fromHour = policy.AFTER_HOURS_FROM_HOUR;
  const afterHours = fromHour === null ? null : afterHoursSurcharge(policy.WEEKEND_PER_HOUR);
  const eveningRule = fromHour !== null && afterHours ? { fromHour, surcharge: afterHours } : null;
  return days.map((day) => {
    const [y, m, d] = dateKeyParts(day.dateKey);
    // Read at UTC noon so no time-zone offset can tip the date key into a neighbouring day.
    const weekday = weekdayOf(new Date(Date.UTC(y, m - 1, d, 12)));
    const holiday = holidays.get(day.dateKey)?.name ?? null;
    const surcharge = dateSurcharge(holiday, weekday, rules);
    if (surcharge) return { ...day, surcharge, afterHours: null };
    return { ...day, surcharge: null, afterHours: eveningRule };
  });
}
