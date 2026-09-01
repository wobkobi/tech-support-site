// src/features/business/lib/promos.ts
/**
 * @description Active-promo lookup + helpers. Cached 60s; admin writes revalidate.
 */

import { normaliseEmail } from "@/shared/lib/normalise-email";
import { prisma } from "@/shared/lib/prisma";
import { NZ_TZ, nzMinuteOfDay, nzWeekday } from "@/shared/lib/timezone-utils";
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
  /** NZ weekdays the promo is limited to (0 = Sunday); empty means every day. */
  activeWeekdays: number[];
  /** Start of the NZ time-of-day restriction, in minutes past midnight. */
  activeFromMinute: number | null;
  /** End of the NZ time-of-day restriction, in minutes past midnight. */
  activeToMinute: number | null;
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
    activeWeekdays: row.activeWeekdays,
    activeFromMinute: row.activeFromMinute,
    activeToMinute: row.activeToMinute,
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

/** The recurring restriction a promo can carry inside its outer window. */
export interface RecurringWindow {
  /** NZ weekdays the promo applies on (0 = Sunday); empty means every day. */
  activeWeekdays: number[];
  /** Start of the NZ time-of-day range, in minutes past midnight. */
  activeFromMinute: number | null;
  /** End of the NZ time-of-day range, in minutes past midnight. */
  activeToMinute: number | null;
}

/**
 * Whether a promo's recurring restriction admits an appointment.
 *
 * Read in NZ time, never UTC. A UTC weekday check puts the day boundary at 11am
 * or noon NZ depending on daylight saving, so a Tuesday promo would half-apply
 * on Monday and stop applying halfway through Tuesday.
 *
 * The instant judged is the APPOINTMENT, not when the customer is browsing: a
 * Tuesday promo exists to fill Tuesday slots, so someone booking on Monday for a
 * Tuesday job earns it, and someone booking on Tuesday for a Thursday job does
 * not.
 * @param window - The promo's weekday and time-of-day restriction.
 * @param at - The appointment instant.
 * @returns Whether the restriction admits it.
 */
export function matchesRecurringWindow(window: RecurringWindow, at: Date): boolean {
  if (window.activeWeekdays.length > 0 && !window.activeWeekdays.includes(nzWeekday(at))) {
    return false;
  }
  const from = window.activeFromMinute;
  const to = window.activeToMinute;
  // Half a range is not a range. Treating one as open-ended would silently
  // widen a restriction the operator thought they had set.
  if (from == null || to == null) return true;
  const minute = nzMinuteOfDay(at);
  // A range that ends before it starts wraps midnight, so 20:00-02:00 admits
  // both. Read the other way it would admit nothing, which looks like the promo
  // is broken rather than misconfigured.
  return from <= to ? minute >= from && minute <= to : minute >= from || minute <= to;
}

/**
 * Whether a promo restricts itself to part of its window.
 * @param window - The promo's weekday and time-of-day restriction.
 * @returns True when any restriction is set.
 */
export function hasRecurringWindow(window: RecurringWindow): boolean {
  return (
    window.activeWeekdays.length > 0 ||
    (window.activeFromMinute != null && window.activeToMinute != null)
  );
}

/**
 * The promo a quote may be priced with, given what is known about the
 * appointment.
 *
 * Splits the numbers from the words. A restricted promo is still advertised -
 * {@link summariseForBanner} names the restriction - but it must not discount a
 * figure when the appointment cannot be checked against it. Quoting a Tuesday
 * discount to someone who has not picked a day promises a price the invoice
 * will not honour, which is the same failure as quoting a business customer a
 * home-rate promo.
 * @param promo - The resolved promo, or null.
 * @param at - The appointment instant, or null when none has been chosen.
 * @returns The promo to price with, or null.
 */
export function promoForAppointment(
  promo: ActivePromo | null,
  at: Date | null,
): ActivePromo | null {
  if (!promo) return null;
  if (!hasRecurringWindow(promo)) return promo;
  if (!at) return null;
  return matchesRecurringWindow(promo, at) ? promo : null;
}

/** What a promo resolution depends on beyond the moment. */
export interface PromoContext {
  /** The job date to price against. Defaults to now. */
  at?: Date;
  /** A code the customer entered, if any. */
  code?: string | null;
  /** The customer, when they are already on file. */
  contactId?: string | null;
  /**
   * The email being booked with, when no contact exists yet. Per-customer and
   * new-customer limits resolve against it so a public booking is not exempt
   * from them.
   */
  email?: string | null;
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

/** Who a promo's per-customer limits are being judged against. */
interface CustomerIdentity {
  /** Contact row, when one exists. Redemptions are counted against this. */
  contactId: string | null;
  /**
   * Every address that identifies this customer, lowercased. Bookings key on
   * email rather than a contact id, so prior-booking checks use these.
   */
  emails: string[];
}

/**
 * Works out who is being served, from a contact id or the email being booked
 * with.
 *
 * A public booking has an email long before it has a Contact row, and a limit
 * that only bound known customers would exempt exactly the people it is aimed
 * at. Matches the way the booking form's contact lookup does - primary address
 * or alternate, soft-deleted rows excluded - and pulls the contact's other
 * addresses in, so a customer who books under a second email is still the same
 * person.
 * @param context - The resolution context.
 * @returns The contact id and every address that identifies the customer.
 */
async function resolveCustomer(context: PromoContext): Promise<CustomerIdentity> {
  const email = normaliseEmail(context.email);
  // Nothing to match on. Without this the query below would search for an empty
  // address and could match a contact that has one.
  if (!context.contactId && !email) return { contactId: null, emails: [] };

  const contact = await prisma.contact
    .findFirst({
      where: {
        deletedAt: null,
        ...(context.contactId
          ? { id: context.contactId }
          : {
              OR: [
                { email: { equals: email, mode: "insensitive" } },
                { altEmails: { has: email } },
              ],
            }),
      },
      select: { id: true, email: true, altEmails: true },
    })
    .catch(() => null);

  if (!contact) {
    return { contactId: context.contactId ?? null, emails: email ? [email] : [] };
  }
  const emails = new Set<string>();
  if (email) emails.add(email);
  if (contact.email) emails.add(normaliseEmail(contact.email));
  for (const alt of contact.altEmails) emails.add(normaliseEmail(alt));
  return { contactId: contact.id, emails: [...emails].filter(Boolean) };
}

/**
 * Whether a promo's eligibility limits admit this customer.
 *
 * Anything that cannot be checked passes. Refusing a discount to someone the
 * system cannot identify is worse than occasionally allowing a second use, so
 * an anonymous visitor clears the per-customer rules rather than failing them.
 *
 * maxRedemptions is approximate on purpose: two customers can pass the count
 * concurrently and both redeem. A lock is not worth it for a one-operator
 * business, so a promo can go a use or two past its cap under load.
 * @param promo - The promo row being considered.
 * @param customer - Who the limits are judged against.
 * @returns Whether the promo may be used.
 */
async function passesLimits(promo: Promo, customer: CustomerIdentity): Promise<boolean> {
  if (promo.maxRedemptions != null) {
    const used = await prisma.promoRedemption.count({ where: { promoId: promo.id } });
    if (used >= promo.maxRedemptions) return false;
  }

  if (promo.perCustomerLimit != null && customer.contactId) {
    const used = await prisma.promoRedemption.count({
      where: { promoId: promo.id, contactId: customer.contactId },
    });
    if (used >= promo.perCustomerLimit) return false;
  }

  if (promo.newCustomersOnly && customer.emails.length > 0) {
    // Completed only. A held or cancelled booking is not someone who has been
    // served, and counting one would deny a first-timer their own offer.
    const prior = await prisma.booking.count({
      where: { email: { in: customer.emails }, status: "completed" },
    });
    if (prior > 0) return false;
  }

  return true;
}

/**
 * The highest-priority candidate that clears its recurring window and limits.
 *
 * Walked in order rather than filtered in the query: a promo failing its cap
 * should let the next one apply, not leave the customer with nothing. Rows come
 * pre-sorted by the same ordering every other lookup uses.
 * @param rows - Candidate promos, already ordered.
 * @param at - The appointment instant.
 * @param customer - Who the limits are judged against.
 * @returns The promo that applies, or null.
 */
async function firstEligible(
  rows: Promo[],
  at: Date,
  customer: CustomerIdentity,
): Promise<ActivePromo | null> {
  for (const row of rows) {
    if (!matchesRecurringWindow(row, at)) continue;
    if (!(await passesLimits(row, customer))) continue;
    return toActivePromo(row);
  }
  return null;
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
  // Resolved once and reused by both passes: only the limit checks need it, and
  // doing the lookup per candidate would repeat the same query.
  const customer = await resolveCustomer(context);

  if (code) {
    const hits = await prisma.promo
      .findMany({
        where: {
          isActive: true,
          kind: "code",
          code,
          startAt: { lte: at },
          endAt: { gt: at },
        },
        orderBy: PROMO_ORDER,
      })
      .catch(() => []);
    const hit = await firstEligible(hits, at, customer);
    if (hit) return hit;
  }

  const autos = await prisma.promo
    .findMany({
      where: {
        isActive: true,
        kind: "automatic",
        startAt: { lte: at },
        endAt: { gt: at },
      },
      orderBy: PROMO_ORDER,
    })
    .catch(() => []);
  return firstEligible(autos, at, customer);
}

/**
 * Whether another promo already holds a code.
 *
 * Uniqueness is enforced here rather than by a database constraint: MongoDB's
 * unique index counts a second null as a duplicate, and every automatic promo
 * has a null code, so creating a second automatic promo would be rejected
 * outright. Both promo routes call this so the rule cannot drift between them.
 * @param code - The normalised code being claimed, or null when there is none.
 * @param excludeId - Promo being edited, so it does not conflict with itself.
 * @returns True when the code is already taken.
 */
export async function isPromoCodeTaken(code: string | null, excludeId?: string): Promise<boolean> {
  if (!code) return false;
  const clash = await prisma.promo.findFirst({
    where: { code, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return clash !== null;
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

// Plural, because a recurring restriction describes every Tuesday rather than
// one particular one.
const WEEKDAY_NAMES = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
];

/**
 * Formats minutes past midnight as a plain clock time.
 * @param minute - Minutes past NZ midnight, 0-1439.
 * @returns A time like "9am" or "5:30pm".
 */
function formatMinuteOfDay(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const suffix = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

/**
 * Plain-English name for a promo's recurring restriction, or null when it has
 * none.
 *
 * The banner shows a recurring promo whenever its outer window is open, so this
 * is what stops "20% off" reading as an offer that applies right now. Hiding the
 * promo until the day itself would keep it from exactly the person deciding
 * whether to book one.
 * Returned bare, without an "only", so a caller can finish the sentence its own
 * way: the banner appends "only" while the wizard says "available Tuesdays".
 * @param window - The promo's weekday and time-of-day restriction.
 * @returns A phrase like "Tuesdays 9am to 5pm", or null when unrestricted.
 */
export function describeRecurringWindow(window: RecurringWindow): string | null {
  const days = [...window.activeWeekdays].sort((a, b) => a - b);
  const hasTime = window.activeFromMinute != null && window.activeToMinute != null;
  if (days.length === 0 && !hasTime) return null;

  let dayPart = "";
  if (days.length > 0) {
    const isWeekdays = days.length === 5 && days.every((d) => d >= 1 && d <= 5);
    const isWeekend = days.length === 2 && days[0] === 0 && days[1] === 6;
    if (isWeekdays) {
      dayPart = "weekdays";
    } else if (isWeekend) {
      dayPart = "weekends";
    } else {
      const names = days.map((d) => WEEKDAY_NAMES[d] ?? "");
      dayPart =
        names.length === 1
          ? names[0]
          : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    }
  }

  if (!hasTime) return dayPart;
  const timePart = `${formatMinuteOfDay(window.activeFromMinute!)} to ${formatMinuteOfDay(window.activeToMinute!)}`;
  return dayPart ? `${dayPart} ${timePart}` : timePart;
}

/**
 * Customer-facing one-line summary for banner + pricing hero.
 * @param promo - Active promo.
 * @returns Banner string.
 */
export function summariseForBanner(promo: ActivePromo): string {
  const base = `${describePromoDiscount(promo)} until ${formatPromoEnd(promo.endAt)}`;
  const restriction = describeRecurringWindow(promo);
  return restriction ? `${base}, ${restriction} only` : base;
}
