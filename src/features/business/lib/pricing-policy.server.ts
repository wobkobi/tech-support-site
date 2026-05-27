// src/features/business/lib/pricing-policy.server.ts
/**
 * @file pricing-policy.server.ts
 * @description Server-only helpers that need Prisma access. Kept separate from
 * pricing-policy.ts so the client-safe module stays importable everywhere
 * without dragging Prisma into the browser bundle.
 */

import "server-only";
import Holidays from "date-holidays";
import { prisma } from "@/shared/lib/prisma";
import {
  PUBLIC_HOLIDAY_UPLIFT,
  NZ_REGION,
  HOME_REGION,
  nzDateKey,
} from "@/features/business/lib/pricing-policy";

/** One labour modifier as rendered on the pricing page accordion. */
export interface PublicModifier {
  label: string;
  /** Effective $/hr after applying the modifier to the Standard base rate. */
  effectiveRate: number;
  /** Customer-facing delta description (e.g. "+$20", "-$10", "+25%"). */
  deltaDescription: string;
  /** Brief context line shown beneath the rate (e.g. "data recovery, hardware repair"). */
  description: string;
}

/** Shape consumed by the pricing page. Built from the live RateConfig rows. */
export interface PublicPricing {
  /** Standard hourly rate (`isDefault: true` row, or first hourly row as fallback). */
  baseRate: number;
  /** Standard rate + Complex modifier delta. */
  complexRate: number;
  /** Travel hourly rate, used for round-trip drive billing. */
  travelRatePerHour: number;
  /** Customer-facing modifier list rendered in the Modifiers accordion. */
  modifiers: PublicModifier[];
  /** Most-recent updatedAt across all RateConfig rows; powers the "rates last updated" footer. */
  ratesUpdatedAt: Date | null;
}

/** Per-label description shown under each modifier on the accordion. */
const MODIFIER_DESCRIPTIONS: Record<string, string> = {
  Complex: "Data recovery, hardware repair, PC builds, full system migrations.",
  Remote: "Screen-share session - I log in instead of visiting.",
  "At home": "Residential discount available on request.",
  "Public Holiday": "Applied automatically on NZ public holidays.",
};

/**
 * Public pricing snapshot for the pricing + FAQ pages. Reads RateConfig
 * directly so the render takes one Prisma round-trip. Falls back to
 * hardcoded $65 / $40 defaults when a row is missing.
 * @returns Live pricing snapshot.
 */
export async function getPublicPricing(): Promise<PublicPricing> {
  const rows = await prisma.rateConfig.findMany({ orderBy: { label: "asc" } });

  const baseRate =
    rows.find((r) => r.ratePerHour !== null && r.isDefault)?.ratePerHour ??
    rows.find((r) => r.ratePerHour !== null && r.unit === "hour")?.ratePerHour ??
    65;

  const complexDelta = rows.find((r) => r.label === "Complex")?.hourlyDelta ?? 0;
  const complexRate = Math.round((baseRate + complexDelta) * 100) / 100;

  const travelRatePerHour =
    rows.find((r) => r.unit === "travel-hour" && r.ratePerHour !== null)?.ratePerHour ?? 40;

  // Public Holiday uses percentDelta; the rest use hourlyDelta.
  const modifiers: PublicModifier[] = [];
  for (const row of rows) {
    if (row.unit !== "modifier") continue;
    if (row.label === "Complex" && row.hourlyDelta !== null) {
      modifiers.push({
        label: row.label,
        effectiveRate: Math.round((baseRate + row.hourlyDelta) * 100) / 100,
        deltaDescription: row.hourlyDelta > 0 ? `+$${row.hourlyDelta}` : `-$${-row.hourlyDelta}`,
        description: MODIFIER_DESCRIPTIONS[row.label] ?? "",
      });
    } else if ((row.label === "Remote" || row.label === "At home") && row.hourlyDelta !== null) {
      modifiers.push({
        label: row.label,
        effectiveRate: Math.round((baseRate + row.hourlyDelta) * 100) / 100,
        deltaDescription: row.hourlyDelta > 0 ? `+$${row.hourlyDelta}` : `-$${-row.hourlyDelta}`,
        description: MODIFIER_DESCRIPTIONS[row.label] ?? "",
      });
    } else if (row.label === "Public Holiday" && row.percentDelta !== null) {
      const pct = Math.round((row.percentDelta ?? PUBLIC_HOLIDAY_UPLIFT) * 100);
      modifiers.push({
        label: row.label,
        effectiveRate:
          Math.round(baseRate * (1 + (row.percentDelta ?? PUBLIC_HOLIDAY_UPLIFT)) * 100) / 100,
        deltaDescription: `+${pct}%`,
        description: MODIFIER_DESCRIPTIONS[row.label] ?? "",
      });
    }
  }

  // Latest mtime across rows; powers the "Rates last updated on {date}" footer.
  const ratesUpdatedAt = rows.reduce<Date | null>((max, r) => {
    const t = r.updatedAt;
    if (!t) return max;
    if (!max) return t;
    return t > max ? t : max;
  }, null);

  return {
    baseRate,
    complexRate,
    travelRatePerHour,
    modifiers,
    ratesUpdatedAt,
  };
}

// Cached Holidays instances. The nationwide instance covers all public
// holidays; the Auckland instance is queried separately for the regional
// anniversary day. date-holidays computes algorithmically, so the same
// instance is reused for every year.
const hdNz = new Holidays("NZ");
const hdAuckland = new Holidays("NZ", "AUK");

/**
 * Returns the `date-holidays` match for an NZ-local YYYY-MM-DD, or null.
 * Checks the nationwide instance first; falls back to the Auckland-regional
 * instance for the anniversary day. Only `type: "public"` entries count.
 * @param key - NZ-local YYYY-MM-DD date string.
 * @returns `{ name, region }` or null.
 */
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
