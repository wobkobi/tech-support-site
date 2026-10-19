// src/features/business/lib/pricing-policy.server.ts
// Server-only pricing helpers that need Prisma, kept out of the client-safe pricing-policy.ts.

import { formatMoneyCompact } from "@/features/business/lib/business-format";
import {
  dateSurcharge,
  FALLBACK_BASE_RATE,
  FALLBACK_BUSINESS_DELTA,
  GST_RATE,
  HOME_REGION,
  NZ_REGION,
  type DateSurcharge,
  type Policy,
} from "@/features/business/lib/pricing-policy";
import { roundCents } from "@/shared/lib/money";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { dateKeyParts, nzDateKey, weekdayOf } from "@/shared/lib/timezone-utils";
import Holidays from "date-holidays";
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
    PUBLIC_HOLIDAY_UPLIFT: pricing.publicHolidayUplift,
    WEEKEND_UPLIFT: pricing.weekendUplift,
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
  /** Effective business hourly rate (base + Business modifier delta); shown on /business only. */
  businessRate: number;
  /** Customer-facing modifier list rendered in the Modifiers accordion. */
  modifiers: PublicModifier[];
  /** Most-recent updatedAt across all RateConfig rows; powers the "rates last updated" footer. */
  ratesUpdatedAt: Date | null;
}

/** Per-label description shown under each modifier on the accordion. */
const MODIFIER_DESCRIPTIONS: Record<string, string> = {
  Remote: "Screen-share session - I log in instead of visiting.",
  "At home": "Bench repair at my place - I take the device home to fix it instead of visiting.",
  Phone: "Help over the phone - quick calls are often free; longer fixes bill at this rate.",
  "Public Holiday": "Applied automatically on NZ public holidays.",
  Weekend: "Applied automatically on Saturdays and Sundays (not on top of a public holiday).",
};

/**
 * Public pricing snapshot for the pricing + FAQ pages and the layout JSON-LD, from
 * {@link getRateRows} and settings, deduped per request.
 * @returns Live pricing snapshot.
 */
export const getPublicPricing = cache(async (): Promise<PublicPricing> => {
  const [rows, { pricing }] = await Promise.all([getRateRows(), getSettings()]);

  const baseRate =
    rows.find((r) => r.ratePerHour !== null && r.isDefault)?.ratePerHour ??
    rows.find((r) => r.ratePerHour !== null && r.unit === "hour")?.ratePerHour ??
    FALLBACK_BASE_RATE;

  // A pricing setting, not a rate row, so the calculator's rate panel can't change it.
  const travelRatePerHour = pricing.travelRatePerHour;

  // Base + the Business row's delta; only /business shows it, not the accordion below.
  const businessDelta =
    rows.find((r) => r.label === "Business" && r.unit === "modifier")?.hourlyDelta ??
    FALLBACK_BUSINESS_DELTA;
  const businessRate = roundCents(baseRate + businessDelta);

  // Public Holiday uses percentDelta; the rest use hourlyDelta.
  const modifiers: PublicModifier[] = [];
  for (const row of rows) {
    if (row.unit !== "modifier") continue;
    if (
      (row.label === "Remote" || row.label === "At home" || row.label === "Phone") &&
      row.hourlyDelta !== null
    ) {
      modifiers.push({
        label: row.label,
        kind: "delta",
        effectiveRate: roundCents(baseRate + row.hourlyDelta),
        deltaDescription: row.hourlyDelta > 0 ? `+$${row.hourlyDelta}` : `-$${-row.hourlyDelta}`,
        description: MODIFIER_DESCRIPTIONS[row.label] ?? "",
      });
    } else if (row.label === "Public Holiday") {
      // Uplift from the pricing settings (what is charged), not the row's percentDelta.
      // Shown in dollars of full labour so it adds up beside a promo-discounted headline.
      const uplift = pricing.publicHolidayUplift;
      const upliftPerHour = roundCents(baseRate * uplift);
      modifiers.push({
        label: row.label,
        kind: "uplift",
        effectiveRate: roundCents(baseRate + upliftPerHour),
        deltaDescription: `+${formatMoneyCompact(upliftPerHour)}`,
        description: MODIFIER_DESCRIPTIONS[row.label] ?? "",
      });
    }
  }
  // Weekend has no rate row; described like the holiday uplift.
  if (pricing.weekendUplift > 0) {
    const upliftPerHour = roundCents(baseRate * pricing.weekendUplift);
    modifiers.push({
      label: "Weekend",
      kind: "uplift",
      effectiveRate: roundCents(baseRate + upliftPerHour),
      deltaDescription: `+${formatMoneyCompact(upliftPerHour)}`,
      description: MODIFIER_DESCRIPTIONS.Weekend ?? "",
    });
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
    businessRate,
    modifiers,
    ratesUpdatedAt: isoMax ? new Date(isoMax) : null,
  };
});

// Nationwide and Auckland (anniversary day) instances; algorithmic, so one serves every year.
const hdNz = new Holidays("NZ");
const hdAuckland = new Holidays("NZ", "AUK");

/**
 * Scans a `date-holidays` result list for an entry matching the given NZ-local
 * date key. Only `type: "public"` entries count.
 * @param list - List of holidays for one year from a `Holidays` instance.
 * @param key - NZ-local YYYY-MM-DD date string.
 * @param region - Region label to tag the match with.
 * @returns `{ name, region }` or null.
 */
function matchInHolidayList(
  list: ReturnType<typeof hdNz.getHolidays>,
  key: string,
  region: string,
): { name: string; region: string } | null {
  for (const h of list) {
    if (h.type !== "public") continue;
    if (typeof h.date === "string" && h.date.slice(0, 10) === key) {
      return { name: h.name, region };
    }
  }
  return null;
}

/**
 * Returns the `date-holidays` match for an NZ-local YYYY-MM-DD, nationwide first, then Auckland.
 * @param key - NZ-local YYYY-MM-DD date string.
 * @returns `{ name, region }` or null.
 */
function holidayFromPackage(key: string): { name: string; region: string } | null {
  const [year = ""] = key.split("-");
  const yearInt = parseInt(year, 10);
  return (
    matchInHolidayList(hdNz.getHolidays(yearInt), key, NZ_REGION) ??
    matchInHolidayList(hdAuckland.getHolidays(yearInt), key, HOME_REGION)
  );
}

/**
 * Looks up the NZ or home-region public holiday on a date (NZ-local), from the `PublicHoliday`
 * table, falling back to `date-holidays` when no row matches or the table is unreachable.
 * @param d - Booking timestamp (UTC); compared against the NZ-local date key.
 * @returns `{ name, region }` of the holiday, or null.
 */
export async function lookupPublicHoliday(
  d: Date,
): Promise<{ name: string; region: string } | null> {
  const key = nzDateKey(d);
  try {
    const row = await prisma.publicHoliday.findFirst({
      where: { date: key, region: { in: [NZ_REGION, HOME_REGION] } },
      orderBy: { region: "asc" },
    });
    if (row) return { name: row.name, region: row.region };
  } catch (err) {
    console.warn("[pricing-policy] PublicHoliday lookup failed; using fallback:", err);
  }
  return holidayFromPackage(key);
}

/**
 * Batch variant of {@link lookupPublicHoliday}: one table read for every key, with the
 * `date-holidays` fallback filling gaps.
 * @param keys - NZ-local YYYY-MM-DD date strings.
 * @returns Map from date key to `{ name, region }`; non-holiday keys are absent.
 */
export async function lookupPublicHolidaysForKeys(
  keys: string[],
): Promise<Map<string, { name: string; region: string }>> {
  const result = new Map<string, { name: string; region: string }>();
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
    if (result.has(key)) continue;
    const fallback = holidayFromPackage(key);
    if (fallback) result.set(key, fallback);
  }
  return result;
}

/**
 * Attaches each booking day's labour surcharge via {@link dateSurcharge}, the same rule
 * invoices bill with.
 * @param days - Bookable days keyed by NZ-local date.
 * @returns The same days, each with `surcharge` set (null when none applies).
 */
export async function withDateSurcharges<T extends { dateKey: string }>(
  days: T[],
): Promise<Array<T & { surcharge: DateSurcharge | null }>> {
  const [policy, holidays] = await Promise.all([
    getPolicy(),
    lookupPublicHolidaysForKeys(days.map((d) => d.dateKey)),
  ]);
  const uplifts = {
    publicHolidayUplift: policy.PUBLIC_HOLIDAY_UPLIFT,
    weekendUplift: policy.WEEKEND_UPLIFT,
  };
  return days.map((day) => {
    const [y, m, d] = dateKeyParts(day.dateKey);
    // Read at UTC noon so no time-zone offset can tip the date key into a neighbouring day.
    const weekday = weekdayOf(new Date(Date.UTC(y, m - 1, d, 12)));
    const holiday = holidays.get(day.dateKey)?.name ?? null;
    return { ...day, surcharge: dateSurcharge(holiday, weekday, uplifts) };
  });
}
