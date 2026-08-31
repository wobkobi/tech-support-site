// src/features/business/lib/promos.ts
/**
 * @description Active-promo lookup + helpers. Cached 60s; admin writes revalidate.
 */

import { prisma } from "@/shared/lib/prisma";
import { NZ_TZ } from "@/shared/lib/timezone-utils";
import { unstable_cache } from "next/cache";

/** Cache tag invalidated by the promo CRUD routes. */
export const ACTIVE_PROMO_TAG = "active-promo";

/** The fields promo selection needs. Real Promo rows satisfy this structurally. */
export interface PromoCandidate {
  id: string;
  priority: number;
  createdAt: Date;
}

/**
 * Picks the winning promo from overlapping candidates: highest priority, then
 * newest. The createdAt tie-break is what every promo used before priority
 * existed, so leaving them all at 0 preserves today's behaviour exactly.
 *
 * The queries below reach the same answer through their own orderBy, since
 * findFirst does the work in the database. This is the rule written down once,
 * unit-testable without a connection, and is what the admin overlap warning
 * uses to name a winner - so the warning cannot disagree with the query.
 * @param candidates - Promos whose windows all contain the moment in question.
 * @returns The winner, or null when there are no candidates.
 */
export function pickWinningPromo<T extends PromoCandidate>(candidates: T[]): T | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, row) => {
    if (row.priority !== best.priority) return row.priority > best.priority ? row : best;
    return row.createdAt > best.createdAt ? row : best;
  });
}

/** Which stage of the quote a promo acts on. */
export type PromoDiscountType = "flat_hourly" | "percent" | "fixed_amount" | "free_travel";

/** Plain-data promo shape exposed across the app. */
export interface ActivePromo {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  /** Null on rows written before the column existed; treated as a rate promo. */
  discountType: PromoDiscountType | null;
  flatHourlyRate: number | null;
  percentDiscount: number | null;
  fixedAmount: number | null;
  travelPercent: number | null;
}

/** The parts of a priced job a promo can act on after the band is built. */
export interface QuoteParts {
  /** Low end of the labour band, in dollars. */
  labourLow: number;
  /** High end of the labour band, in dollars. */
  labourHigh: number;
  /** Round-trip travel charge, in dollars. */
  travel: number;
}

/**
 * Rounds a dollar figure to cents, keeping the arithmetic out of float drift.
 * @param value - Raw dollar amount.
 * @returns The amount rounded to two decimal places.
 */
function toCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Applies the promo types that act on the whole quote, after the labour band
 * and travel have been priced.
 *
 * The rate-based types are deliberately absent here: the pipeline discounts the
 * hourly rate BEFORE priceRangeFor builds the band, so moving them to this
 * stage would round differently and shift existing prices. They stay in
 * {@link applyPromoToHourlyRate} and this function leaves them alone.
 * @param parts - The priced labour band and travel charge.
 * @param promo - Resolved promo, or null.
 * @returns The parts after any quote-level discount.
 */
export function applyPromoToQuote(parts: QuoteParts, promo: ActivePromo | null): QuoteParts {
  if (!promo) return parts;

  if (promo.discountType === "free_travel" && promo.travelPercent !== null) {
    const factor = Math.min(1, Math.max(0, promo.travelPercent));
    return { ...parts, travel: toCents(parts.travel * factor) };
  }

  if (promo.discountType === "fixed_amount" && promo.fixedAmount !== null) {
    // Off labour only, floored at zero. Travel is the operator's actual driving
    // time rather than a margin, so a discount larger than the labour is capped
    // instead of eating into it - and the floor stops a small job quoting a
    // negative figure.
    const off = Math.max(0, promo.fixedAmount);
    return {
      ...parts,
      labourLow: toCents(Math.max(0, parts.labourLow - off)),
      labourHigh: toCents(Math.max(0, parts.labourHigh - off)),
    };
  }

  return parts;
}

/**
 * Returns the currently-active promo or null. Highest priority wins on overlap,
 * then newest.
 * @returns Active promo or null.
 */
export const getActivePromo = unstable_cache(
  async (): Promise<ActivePromo | null> => {
    const now = new Date();
    const row = await prisma.promo.findFirst({
      where: {
        isActive: true,
        startAt: { lte: now },
        endAt: { gt: now },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    });
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      discountType: row.discountType,
      flatHourlyRate: row.flatHourlyRate,
      percentDiscount: row.percentDiscount,
      fixedAmount: row.fixedAmount,
      travelPercent: row.travelPercent,
    };
  },
  ["active-promo"],
  { tags: [ACTIVE_PROMO_TAG], revalidate: 60 },
);

/**
 * Resolves the promo that was in force on a given date (highest priority wins
 * on overlap, then newest). Used by the admin calculator to price a past job
 * with the promo that was live when the work actually happened, not today's.
 * @param date - The job date to resolve against.
 * @returns Resolved promo or null.
 */
export async function resolvePromoForDate(date: Date): Promise<ActivePromo | null> {
  const row = await prisma.promo
    .findFirst({
      where: { isActive: true, startAt: { lte: date }, endAt: { gt: date } },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    })
    .catch(() => null);
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    discountType: row.discountType,
    flatHourlyRate: row.flatHourlyRate,
    percentDiscount: row.percentDiscount,
    fixedAmount: row.fixedAmount,
    travelPercent: row.travelPercent,
  };
}

/**
 * Applies a promo to one hourly rate. Flat overrides (capped at original); percent multiplies.
 * @param rate - Pre-promo $/hr.
 * @param promo - Active promo or null.
 * @returns Effective $/hr.
 */
export function applyPromoToHourlyRate(rate: number, promo: ActivePromo | null): number {
  if (!promo) return rate;
  // fixed_amount and free_travel act on the priced quote, not the rate.
  if (promo.discountType === "fixed_amount" || promo.discountType === "free_travel") {
    return rate;
  }
  if (promo.flatHourlyRate !== null) {
    // Never raise the price - a promo above the base rate is a misconfig.
    return Math.min(rate, promo.flatHourlyRate);
  }
  if (promo.percentDiscount !== null) {
    const factor = Math.max(0, 1 - promo.percentDiscount);
    return Math.round(rate * factor * 100) / 100;
  }
  return rate;
}

/**
 * Friendly end-date phrase: "this Saturday" within a week, "Sat 16 May" beyond.
 * @param endIso - Promo `endAt` ISO timestamp.
 * @param now - Reference time (injected for tests).
 * @returns Short date phrase.
 */
function formatPromoEnd(endIso: string, now: Date = new Date()): string {
  const end = new Date(endIso);
  const diffDays = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  // Within a week: anchor on weekday ("I have until Friday"). Pin to NZ time so
  // a promo ending between NZ midnight and noon isn't labelled the prior day.
  if (diffDays <= 7 && diffDays > 0) {
    const weekday = new Intl.DateTimeFormat("en-NZ", {
      timeZone: NZ_TZ,
      weekday: "long",
    }).format(end);
    return `this ${weekday}`;
  }

  // Otherwise short date; year only if not current year.
  const sameYear = end.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(end);
}

/**
 * Customer-facing one-line summary for banner + pricing hero.
 * @param promo - Active promo.
 * @returns Banner string.
 */
export function summariseForBanner(promo: ActivePromo): string {
  const until = formatPromoEnd(promo.endAt);
  if (promo.flatHourlyRate !== null) {
    return `$${promo.flatHourlyRate}/hr on all jobs until ${until}`;
  }
  if (promo.percentDiscount !== null) {
    const pctLabel = `${Math.round(promo.percentDiscount * 100)}% off`;
    return `${pctLabel} all jobs until ${until}`;
  }
  return `Limited offer until ${until}`;
}
