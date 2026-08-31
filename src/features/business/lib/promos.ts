// src/features/business/lib/promos.ts
/**
 * @description Active-promo lookup + helpers. Cached 60s; admin writes revalidate.
 */

import { prisma } from "@/shared/lib/prisma";
import { NZ_TZ } from "@/shared/lib/timezone-utils";
import type { Promo } from "@prisma/client";
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

/** How a customer comes by a promo. Mirrors the `PromoKind` enum in the schema. */
export type PromoKind = "automatic" | "code";

/** Plain-data promo shape exposed across the app. */
export interface ActivePromo {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  /** Automatic promos apply to everyone; a code promo only to whoever enters it. */
  kind: PromoKind;
  /** Uppercase code for a code promo, null for an automatic one. */
  code: string | null;
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

/** Ordering for every promo lookup: highest priority wins, then newest. */
const PROMO_ORDER = [{ priority: "desc" as const }, { createdAt: "desc" as const }];

/**
 * Maps a database row to the plain shape the rest of the app passes around.
 *
 * One copy on purpose: three lookups return this shape, and a new column added
 * to two of them is exactly the drift that broke promo editing in Phase 2.
 * @param row - The promo row as stored.
 * @returns The promo in its cross-app shape.
 */
function toActivePromo(row: Promo): ActivePromo {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    kind: row.kind,
    code: row.code,
    discountType: row.discountType,
    flatHourlyRate: row.flatHourlyRate,
    percentDiscount: row.percentDiscount,
    fixedAmount: row.fixedAmount,
    travelPercent: row.travelPercent,
  };
}

/**
 * Returns the currently-active automatic promo or null. Highest priority wins
 * on overlap, then newest.
 *
 * Automatic only, and deliberately so: every caller is a display surface, and
 * a code promo advertised on the banner or the pricing page would be offered to
 * people who never entered the code. Widening this filter re-opens that.
 * @returns Active automatic promo or null.
 */
export const getActivePromo = unstable_cache(
  async (): Promise<ActivePromo | null> => {
    const now = new Date();
    const row = await prisma.promo.findFirst({
      where: {
        isActive: true,
        kind: "automatic",
        startAt: { lte: now },
        endAt: { gt: now },
      },
      orderBy: PROMO_ORDER,
    });
    return row ? toActivePromo(row) : null;
  },
  ["active-promo"],
  { tags: [ACTIVE_PROMO_TAG], revalidate: 60 },
);

/** What a promo resolution depends on beyond the moment. */
export interface PromoContext {
  /** The job date to price against. Defaults to now. */
  at?: Date;
  /** A code the customer entered, if any. */
  code?: string | null;
}

/**
 * Uppercases and trims a customer-entered code, or returns null when there was
 * not one. Stored codes are uppercase, so comparing anything else silently
 * fails to match and a real code is reported as invalid.
 * @param raw - The code as typed.
 * @returns The comparable code, or null.
 */
export function normalisePromoCode(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

/**
 * The promo that applies to one request.
 *
 * Not cached, unlike {@link getActivePromo}: the answer depends on the code
 * entered, so two visitors at the same instant can be entitled to different
 * promos.
 *
 * A valid code wins outright - someone who went to the trouble of entering one
 * must never lose to a background automatic promo. An invalid or expired code
 * falls through to the automatic promo rather than blocking it; the caller
 * reports the code as invalid separately.
 * @param context - The job date and any entered code.
 * @returns The promo that applies, or null.
 */
export async function resolvePromo(context: PromoContext): Promise<ActivePromo | null> {
  const at = context.at ?? new Date();
  const code = normalisePromoCode(context.code);

  if (code) {
    const hit = await prisma.promo
      .findFirst({
        where: {
          isActive: true,
          kind: "code",
          code,
          startAt: { lte: at },
          endAt: { gt: at },
        },
        orderBy: PROMO_ORDER,
      })
      .catch(() => null);
    if (hit) return toActivePromo(hit);
  }

  const auto = await prisma.promo
    .findFirst({
      where: {
        isActive: true,
        kind: "automatic",
        startAt: { lte: at },
        endAt: { gt: at },
      },
      orderBy: PROMO_ORDER,
    })
    .catch(() => null);
  return auto ? toActivePromo(auto) : null;
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
 * The labour rate to quote while a promo runs. For a fixed amount this is the
 * one-hour illustration described on {@link promoRateBeforeAfter}; for a travel
 * promo the labour rate is untouched.
 * @param baseRate - The undiscounted hourly rate.
 * @param promo - Active promo, or null.
 * @returns The rate to display.
 */
export function promoDisplayRate(baseRate: number, promo: ActivePromo | null): number {
  if (!promo) return baseRate;
  return promoRateBeforeAfter(baseRate, promo)?.after ?? baseRate;
}

/**
 * The fraction of travel still charged while a promo runs: 1 when no travel
 * promo applies, 0 when travel is free. Multiply any travel figure - the hourly
 * drive rate, the minimum charge - by this to quote it correctly.
 * @param promo - Active promo, or null.
 * @returns The fraction charged, 0 to 1.
 */
export function promoTravelFactor(promo: ActivePromo | null): number {
  if (!promo || promo.discountType !== "free_travel" || promo.travelPercent === null) return 1;
  return Math.min(1, Math.max(0, promo.travelPercent));
}

/**
 * The rate a modified job actually bills at while a promo runs.
 *
 * The two modifier kinds combine with a promo differently, and mirroring the
 * engine matters or the page quotes a rate the invoice will not charge:
 *
 * - A "delta" modifier changes the task's own $/hr, so the promo discounts the
 *   already-modified figure: a phone job at $40 under 15% off bills at $34.
 * - An "uplift" is a surcharge calculated on FULL labour, and the promo
 *   discount is taken from full labour too, so the two are additive rather
 *   than multiplied. A public holiday at +25% under 15% off bills at
 *   base + 25% of base - 15% of base, not the uplifted rate times 0.85.
 * @param baseRate - The undiscounted hourly rate.
 * @param modifierRate - The modifier's rate before any promo.
 * @param kind - Whether the modifier changes the rate or adds a surcharge.
 * @param promo - Active promo, or null.
 * @returns The rate actually charged.
 */
export function promoModifierRate(
  baseRate: number,
  modifierRate: number,
  kind: "delta" | "uplift",
  promo: ActivePromo | null,
): number {
  if (!promo) return modifierRate;
  if (kind === "delta") return promoDisplayRate(modifierRate, promo);
  const discountPerHour = baseRate - promoDisplayRate(baseRate, promo);
  return Math.round((modifierRate - discountPerHour) * 100) / 100;
}

/** A crossed-out "before" figure and the one a promo leaves in its place. */
export interface PromoBeforeAfter {
  before: number;
  after: number;
}

/**
 * The hourly pair the pricing page crosses out, or null when the promo leaves
 * the hourly figure alone.
 *
 * For a fixed amount this is the rate minus the discount, which is a one-hour
 * illustration rather than a rate anyone is charged: a 30-minute job under a
 * $10-off promo saves $10, not half the hourly reduction. Shown this way at the
 * operator's request, so the headline moves for every promo type that saves
 * money on labour.
 * @param baseRate - The undiscounted hourly rate.
 * @param promo - Active promo.
 * @returns The pair, or null when the hourly figure is unaffected.
 */
export function promoRateBeforeAfter(
  baseRate: number,
  promo: ActivePromo,
): PromoBeforeAfter | null {
  if (promo.discountType === "free_travel") return null;
  if (promo.discountType === "fixed_amount" && promo.fixedAmount !== null) {
    const after = Math.max(0, Math.round((baseRate - promo.fixedAmount) * 100) / 100);
    return after < baseRate ? { before: baseRate, after } : null;
  }
  const after = applyPromoToHourlyRate(baseRate, promo);
  return after < baseRate ? { before: baseRate, after } : null;
}

/**
 * The travel pair the pricing page crosses out, or null when the promo leaves
 * travel alone. Anchored on the minimum travel charge, since the real figure
 * depends on the drive.
 * @param minTravelCharge - The minimum charged for a visit's travel.
 * @param promo - Active promo.
 * @returns The pair, or null when travel is unaffected.
 */
export function promoTravelBeforeAfter(
  minTravelCharge: number,
  promo: ActivePromo,
): PromoBeforeAfter | null {
  if (promo.discountType !== "free_travel" || promo.travelPercent === null) return null;
  const factor = Math.min(1, Math.max(0, promo.travelPercent));
  const after = Math.round(minTravelCharge * factor * 100) / 100;
  return after < minTravelCharge ? { before: minTravelCharge, after } : null;
}

/**
 * What a promo gives, with no date attached - "$10 off", "Free travel".
 *
 * Deliberately unscoped. Promos are a home-rate offer and business work is
 * excluded, but rather than qualify every phrase, the banner is suppressed on
 * the business page - see PromoBannerClient.
 *
 * Split out of {@link summariseForBanner} because the
 * pricing page states the end date separately and would otherwise say it
 * twice, and because a non-rate promo leaves the headline $/hr unchanged and
 * needs this line to say what the offer actually is.
 * @param promo - Active promo.
 * @returns The offer phrase.
 */
export function describePromoDiscount(promo: ActivePromo): string {
  if (promo.discountType === "free_travel" && promo.travelPercent !== null) {
    // 0 means nothing is charged for the drive; anything else is a part-charge.
    return promo.travelPercent === 0
      ? "Free travel"
      : `${Math.round((1 - promo.travelPercent) * 100)}% off travel`;
  }
  if (promo.discountType === "fixed_amount" && promo.fixedAmount !== null) {
    return `$${promo.fixedAmount} off`;
  }
  if (promo.flatHourlyRate !== null) {
    return `$${promo.flatHourlyRate}/hr`;
  }
  if (promo.percentDiscount !== null) {
    return `${Math.round(promo.percentDiscount * 100)}% off`;
  }
  return "Limited offer";
}

/**
 * Customer-facing one-line summary for banner + pricing hero.
 * @param promo - Active promo.
 * @returns Banner string.
 */
export function summariseForBanner(promo: ActivePromo): string {
  return `${describePromoDiscount(promo)} until ${formatPromoEnd(promo.endAt)}`;
}
