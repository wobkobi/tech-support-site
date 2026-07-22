// src/features/business/lib/pricing-policy.server.ts
/**
 * @description Server-only helpers that need Prisma access. Kept separate from
 * pricing-policy.ts so the client-safe module stays importable everywhere
 * without dragging Prisma into the browser bundle.
 */

import {
  FALLBACK_BASE_RATE,
  FALLBACK_BUSINESS_DELTA,
  GST_RATE,
  HOME_REGION,
  NZ_REGION,
  nzDateKey,
  type Policy,
} from "@/features/business/lib/pricing-policy";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import Holidays from "date-holidays";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import "server-only";

/** Cache tag busted by every RateConfig write so rate edits go live immediately. */
export const RATE_CONFIG_TAG = "rate-config";

/**
 * RateConfig snapshot as stored in the data cache. `unstable_cache` JSON
 * round-trips its value, so `updatedAt` is normalised to an ISO string up
 * front - the shape is then identical on cache hit and miss.
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
 * Cached RateConfig rows for the public pages and the public rates API.
 * Tagged with {@link RATE_CONFIG_TAG}; the admin rate routes bust the tag on
 * every write, so the 5-minute revalidate only matters as a safety net.
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
  { tags: [RATE_CONFIG_TAG], revalidate: 300 },
);

/**
 * Live policy bundle, resolved from the settings panel (defaults + DB override).
 * Server-only because it reads the settings store; client code receives the
 * resolved values as props. {@link GST_RATE} stays a legislated constant.
 * Wrapped in React `cache` so repeat calls within one request dedupe.
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
    PUBLIC_HOLIDAY_UPLIFT: pricing.publicHolidayUplift,
    UNSUCCESSFUL_WORK_FACTOR: pricing.unsuccessfulWorkFactor,
    WORKMANSHIP_WINDOW_DAYS: pricing.workmanshipWindowDays,
    CANCELLATION: pricing.cancellation,
  };
});

/** One labour modifier as rendered on the pricing page accordion. */
interface PublicModifier {
  label: string;
  /** Effective $/hr after applying the modifier to the base hourly rate. */
  effectiveRate: number;
  /** Customer-facing delta description (e.g. "+$20", "-$10", "+25%"). */
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
};

/**
 * Public pricing snapshot for the pricing + FAQ pages and the layout JSON-LD.
 * Reads the tag-cached rate rows ({@link getRateRows}) alongside the cached
 * settings, and dedupes repeat calls within one request via React `cache`
 * (layout + generateMetadata + page body all call it). The base rate falls
 * back to the hardcoded $65 default when no hourly row exists; the travel
 * rate comes from the pricing settings.
 * @returns Live pricing snapshot.
 */
export const getPublicPricing = cache(async (): Promise<PublicPricing> => {
  const [rows, { pricing }] = await Promise.all([getRateRows(), getSettings()]);

  const baseRate =
    rows.find((r) => r.ratePerHour !== null && r.isDefault)?.ratePerHour ??
    rows.find((r) => r.ratePerHour !== null && r.unit === "hour")?.ratePerHour ??
    FALLBACK_BASE_RATE;

  // Travel rate is a pricing setting, not a rate row - the operator edits it
  // in Settings > Pricing and it can't drift via the calculator's rate panel.
  const travelRatePerHour = pricing.travelRatePerHour;

  // Business rate = base + the Business modifier row's delta. The row is
  // deliberately absent from the consumer accordion allowlist below; only the
  // /business page renders this figure.
  const businessDelta =
    rows.find((r) => r.label === "Business" && r.unit === "modifier")?.hourlyDelta ??
    FALLBACK_BUSINESS_DELTA;
  const businessRate = Math.round((baseRate + businessDelta) * 100) / 100;

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
        effectiveRate: Math.round((baseRate + row.hourlyDelta) * 100) / 100,
        deltaDescription: row.hourlyDelta > 0 ? `+$${row.hourlyDelta}` : `-$${-row.hourlyDelta}`,
        description: MODIFIER_DESCRIPTIONS[row.label] ?? "",
      });
    } else if (row.label === "Public Holiday") {
      // Single source: the uplift shown here comes from the pricing settings
      // (what getPolicy charges), NOT the RateConfig percentDelta - so the
      // displayed % can never drift from the charged %. The row only needs to
      // exist to surface the modifier on the accordion.
      const uplift = pricing.publicHolidayUplift;
      const pct = Math.round(uplift * 100);
      modifiers.push({
        label: row.label,
        effectiveRate: Math.round(baseRate * (1 + uplift) * 100) / 100,
        deltaDescription: `+${pct}%`,
        description: MODIFIER_DESCRIPTIONS[row.label] ?? "",
      });
    }
  }

  // Latest mtime across rows; powers the "Rates last updated on {date}" footer.
  // Rows carry ISO strings (cache serialisation), which compare correctly
  // lexicographically; rebuild the Date at the end so PublicPricing keeps its shape.
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

// Cached Holidays instances. The nationwide instance covers all public
// holidays; the Auckland instance is queried separately for the regional
// anniversary day. date-holidays computes algorithmically, so the same
// instance is reused for every year.
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
 * Returns the `date-holidays` match for an NZ-local YYYY-MM-DD, or null.
 * Checks the nationwide instance first; falls back to the Auckland-regional
 * instance for the anniversary day.
 * @param key - NZ-local YYYY-MM-DD date string.
 * @returns `{ name, region }` or null.
 */
function holidayFromPackage(key: string): { name: string; region: string } | null {
  const [year] = key.split("-");
  const yearInt = parseInt(year, 10);
  return (
    matchInHolidayList(hdNz.getHolidays(yearInt), key, NZ_REGION) ??
    matchInHolidayList(hdAuckland.getHolidays(yearInt), key, HOME_REGION)
  );
}

/**
 * Looks up the public holiday occurring on the given date (NZ-local). Reads
 * the `PublicHoliday` table first; falls back to algorithmic computation via
 * `date-holidays` when no row matches or the table is unreachable. Only
 * nationwide ("NZ") and the operator's home region are returned.
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
 * Batch variant of {@link lookupPublicHoliday}: one `PublicHoliday` read
 * covers every date key, with the algorithmic `date-holidays` fallback
 * filling any key the table doesn't cover. Used by the admin schedule, which
 * spans a multi-week window and would otherwise pay one DB round-trip per day.
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
