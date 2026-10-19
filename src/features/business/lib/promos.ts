// src/features/business/lib/promos.ts
// Active-promo lookup + helpers, cached until admin writes or the publish cron's
// refreshPromoCacheAtBoundary (promos.server.ts, since client components import this) bust the tag.

import { promoForSpend, type PromoTierValues } from "@/features/business/lib/promo-tiers";
import { roundCents } from "@/shared/lib/money";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { prisma } from "@/shared/lib/prisma";
import { NZ_TZ, nzMinuteOfDay, nzWeekday } from "@/shared/lib/timezone-utils";
import type { Prisma, Promo } from "@prisma/client";
import { unstable_cache } from "next/cache";

/** Cache tag invalidated by the promo CRUD routes. */
export const ACTIVE_PROMO_TAG = "active-promo";

// Re-exported from the pure tier module: every other promo helper lives here,
// and splitting where they are imported from is how two of them drift.
export { promoForSpend, type PromoTierValues };

/** The fields promo selection needs. Real Promo rows satisfy this structurally. */
export interface PromoCandidate {
  id: string;
  priority: number;
  createdAt: Date;
}

/**
 * Picks the winning promo from overlapping candidates: highest priority, then newest.
 * The queries match this via orderBy; the admin overlap warning uses it so it can't disagree.
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
  /** Floor for the pre-discount total, or null when there is none. */
  minSpend: number | null;
  /** Spend bands; when non-empty they supply the discount instead of the columns above. */
  tiers: PromoTierValues[];
  /** NZ weekdays the promo is limited to (0 = Sunday); empty means every day. */
  activeWeekdays: number[];
  /** Start of the NZ time-of-day restriction, in minutes past midnight. */
  activeFromMinute: number | null;
  /** End of the NZ time-of-day restriction, in minutes past midnight. */
  activeToMinute: number | null;
  /** New-customers-only or capped per customer: priced only once the customer is known. */
  customerLimited?: boolean;
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
 * Applies quote-level promo types after the labour band and travel are priced. Rate-based
 * types stay in {@link applyPromoToHourlyRate}: moving them here would round differently.
 * @param parts - The priced labour band and travel charge.
 * @param promo - Resolved promo, or null.
 * @returns The parts after any quote-level discount.
 */
export function applyPromoToQuote(parts: QuoteParts, promo: ActivePromo | null): QuoteParts {
  if (!promo) return parts;

  if (promo.discountType === "free_travel" && promo.travelPercent !== null) {
    const factor = Math.min(1, Math.max(0, promo.travelPercent));
    return { ...parts, travel: roundCents(parts.travel * factor) };
  }

  if (promo.discountType === "fixed_amount" && promo.fixedAmount !== null) {
    // Off labour only, floored at zero: travel is real driving time, not margin.
    const off = Math.max(0, promo.fixedAmount);
    return {
      ...parts,
      labourLow: roundCents(Math.max(0, parts.labourLow - off)),
      labourHigh: roundCents(Math.max(0, parts.labourHigh - off)),
    };
  }

  return parts;
}

/** Ordering for every promo lookup: highest priority wins, then newest. */
export const PROMO_ORDER = [{ priority: "desc" as const }, { createdAt: "desc" as const }];

/**
 * Maps a database row to the plain cross-app shape. One copy, so a new column
 * can't reach only some of the lookups.
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
    minSpend: row.minSpend,
    tiers: row.tiers.map((t) => ({
      minSpend: t.minSpend,
      flatHourlyRate: t.flatHourlyRate,
      percentDiscount: t.percentDiscount,
      fixedAmount: t.fixedAmount,
      travelPercent: t.travelPercent,
    })),
    activeWeekdays: row.activeWeekdays,
    activeFromMinute: row.activeFromMinute,
    activeToMinute: row.activeToMinute,
    customerLimited: row.newCustomersOnly || row.perCustomerLimit != null,
  };
}

/**
 * Promos of one kind that are switched on and inside their start and end dates.
 * @param kind - Promo kind to match.
 * @param now - The instant to test against.
 * @returns Prisma where clause.
 */
export function inWindowWhere(kind: "automatic" | "code", now: Date): Prisma.PromoWhereInput {
  return { isActive: true, kind, startAt: { lte: now }, endAt: { gt: now } };
}

/**
 * Returns the currently-active automatic promo or null. Automatic only: every caller is a
 * display surface. No time-based revalidate, as it would become every public page's ISR
 * interval; refreshPromoCacheAtBoundary in promos.server.ts handles starts and ends.
 * @returns Active automatic promo or null.
 */
export const getActivePromo = unstable_cache(
  async (): Promise<ActivePromo | null> => {
    const row = await prisma.promo.findFirst({
      where: inWindowWhere("automatic", new Date()),
      orderBy: PROMO_ORDER,
    });
    return row ? toActivePromo(row) : null;
  },
  ["active-promo"],
  { tags: [ACTIVE_PROMO_TAG], revalidate: false },
);

/**
 * One automatic promo by id, only while switched on and inside its window. Backs the
 * mailing-list "Email this promo" link; code promos are skipped as in {@link getActivePromo}.
 * @param id - Promo id.
 * @returns The promo, or null when it is missing, a code promo, off or outside its window.
 */
export async function findAdvertisablePromo(id: string): Promise<ActivePromo | null> {
  const row = await prisma.promo.findFirst({
    where: { id, ...inWindowWhere("automatic", new Date()) },
  });
  return row ? toActivePromo(row) : null;
}

/**
 * Whether any code promo is inside its dates, so the booking form only offers a code box
 * while one could work. Weekday/time windows are ignored: the booked slot may fall inside.
 * @returns True when at least one code promo is inside its start and end dates.
 */
export const hasActivePromoCode = unstable_cache(
  async (): Promise<boolean> => {
    const count = await prisma.promo.count({ where: inWindowWhere("code", new Date()) });
    return count > 0;
  },
  ["has-active-promo-code"],
  { tags: [ACTIVE_PROMO_TAG], revalidate: false },
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
 * Whether a promo's recurring restriction admits an appointment. Read in NZ time (a UTC
 * weekday puts the day boundary at 11am or noon NZ) and judged at the appointment, not now.
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
  // Half a range is not a range; treating it as open-ended would silently widen it.
  if (from == null || to == null) return true;
  const minute = nzMinuteOfDay(at);
  // A range that ends before it starts wraps midnight: 20:00-02:00 admits both sides.
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
 * The promo a quote may be priced with. A restricted or customer-limited promo is still
 * advertised ({@link summariseForBanner}) but prices nothing until the appointment and
 * customer are checked, or the quote promises a price the invoice won't honour.
 * @param promo - The resolved promo, or null.
 * @param at - The appointment instant, or null when none has been chosen.
 * @param options - What the server already judged.
 * @param options.customerChecked - True when resolved against the customer's email, so
 *   per-customer limits are settled.
 * @returns The promo to price with, or null.
 */
export function promoForAppointment(
  promo: ActivePromo | null,
  at: Date | null,
  { customerChecked = false }: { customerChecked?: boolean } = {},
): ActivePromo | null {
  if (!promo) return null;
  if (promo.customerLimited && !customerChecked) return null;
  if (!hasRecurringWindow(promo)) return promo;
  if (!at) return null;
  return matchesRecurringWindow(promo, at) ? promo : null;
}

/**
 * The promo a page may price its published rates with (no appointment or job total).
 * Customer-limited promos drop out via {@link promoForAppointment}; spend-floor or tiered
 * promos are named but not priced, since a one-hour job may never earn them.
 * @param promo - The resolved promo, or null.
 * @returns The promo to price the rate card with, or null.
 */
export function promoForRateCard(promo: ActivePromo | null): ActivePromo | null {
  const priced = promoForAppointment(promo, null);
  if (!priced || priced.minSpend != null || priced.tiers.length > 0) return null;
  return priced;
}

/** What a promo resolution depends on beyond the moment. */
export interface PromoContext {
  /**
   * The appointment instant for the weekday/time restriction. Omitted means now; null means
   * none chosen yet, so figures stay gated by {@link promoForAppointment}.
   */
  at?: Date | null;
  /**
   * When the booking was made, judged against the promo's dates: booking during a promo
   * locks the rate in. Defaults to `at` (a walk-up job booked and done the same day).
   */
  bookedAt?: Date;
  /** The booking being priced; its own redemption is left out of limit counts. */
  bookingId?: string | null;
  /** A code the customer entered, if any. */
  code?: string | null;
  /** The customer, when they are already on file. */
  contactId?: string | null;
  /** The email being booked with when no contact exists yet, so customer limits still apply. */
  email?: string | null;
}

/**
 * Uppercases and trims a customer-entered code to match the stored uppercase codes,
 * or returns null when there was not one.
 * @param raw - The code as typed.
 * @returns The comparable code, or null.
 */
export function normalisePromoCode(raw: unknown): string | null {
  // Typed unknown: public routes pass raw JSON, and .trim() on a non-string would throw.
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

/** Who a promo's per-customer limits are being judged against. */
interface CustomerIdentity {
  /** Contact row, when one exists. Redemptions are counted against this. */
  contactId: string | null;
  /** Every lowercased address for this customer; prior-booking checks key on these. */
  emails: string[];
}

/**
 * Works out who is being served from a contact id or the booking email. Matches like the
 * booking form's lookup (primary or alternate, soft-deleted excluded) and adds the contact's other addresses.
 * @param context - The resolution context.
 * @returns The contact id and every address that identifies the customer.
 */
async function resolveCustomer(context: PromoContext): Promise<CustomerIdentity> {
  const email = normaliseEmail(context.email);
  // Nothing to match on; an empty-address query could match a contact.
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
 * Whether a promo's eligibility limits admit this customer. Anything uncheckable passes;
 * maxRedemptions is approximate (no lock). The priced booking's own rows are subtracted,
 * not filtered with `not`, whose SQL null semantics would also drop walk-up redemptions.
 * @param promo - The promo row being considered.
 * @param customer - Who the limits are judged against.
 * @param bookingId - The booking being priced, whose own rows do not count.
 * @returns Whether the promo may be used.
 */
async function passesLimits(
  promo: Promo,
  customer: CustomerIdentity,
  bookingId: string | null,
): Promise<boolean> {
  /**
   * Redemptions of this promo matching a filter, less the booking's own.
   * @param where - Extra filter on top of the promo id.
   * @param where.contactId - Customer to count for, when counting per customer.
   * @returns The count other bookings and jobs account for.
   */
  const countOthers = async (where: { contactId?: string }): Promise<number> => {
    const [all, own] = await Promise.all([
      prisma.promoRedemption.count({ where: { promoId: promo.id, ...where } }),
      bookingId
        ? prisma.promoRedemption.count({ where: { promoId: promo.id, bookingId, ...where } })
        : 0,
    ]);
    return all - own;
  };

  if (promo.maxRedemptions != null) {
    if ((await countOthers({})) >= promo.maxRedemptions) return false;
  }

  if (promo.perCustomerLimit != null && customer.contactId) {
    const used = await countOthers({ contactId: customer.contactId });
    if (used >= promo.perCustomerLimit) return false;
  }

  if (promo.newCustomersOnly && customer.emails.length > 0) {
    // Confirmed or completed only; a held or cancelled one would deny a first-timer.
    const prior = await prisma.booking.count({
      where: {
        email: { in: customer.emails },
        status: { in: ["confirmed", "completed"] },
        ...(bookingId ? { id: { not: bookingId } } : {}),
      },
    });
    if (prior > 0) return false;
  }

  return true;
}

/**
 * The highest-priority candidate that clears its recurring window and limits. Walked in
 * order so a promo failing its cap lets the next one apply.
 * @param rows - Candidate promos, already ordered.
 * @param at - The appointment instant, or null when none has been chosen.
 * @param customer - Who the limits are judged against.
 * @param bookingId - The booking being priced, whose own rows do not count.
 * @returns The promo that applies, or null.
 */
async function firstEligible(
  rows: Promo[],
  at: Date | null,
  customer: CustomerIdentity,
  bookingId: string | null,
): Promise<ActivePromo | null> {
  for (const row of rows) {
    if (at && !matchesRecurringWindow(row, at)) continue;
    if (!(await passesLimits(row, customer, bookingId))) continue;
    return toActivePromo(row);
  }
  return null;
}

/**
 * The two instants a promo resolution judges, with defaults applied. Exported for
 * scripts/check-promo-selection.ts; a null appointment skips the weekday restriction.
 * @param context - The resolution context.
 * @param context.at - The appointment, null when none is chosen, omitted for now.
 * @param context.bookedAt - When the booking was made, if known.
 * @param now - The current instant.
 * @returns `windowAt` for the weekday/time restriction (null skips it) and `datesAt` for
 *   the promo's start and end dates.
 */
export function resolutionInstants(
  context: Pick<PromoContext, "at" | "bookedAt">,
  now: Date,
): { windowAt: Date | null; datesAt: Date } {
  const windowAt = context.at === undefined ? now : context.at;
  return { windowAt, datesAt: context.bookedAt ?? windowAt ?? now };
}

/**
 * The promo that applies to one request (uncached, unlike {@link getActivePromo}: it depends on
 * the code). Dates are judged at `bookedAt`, the weekday/time restriction at `at`. A valid code
 * wins outright; an invalid one falls through to the automatic promo.
 * @param context - The appointment, booking date, customer and any entered code.
 * @returns The promo that applies, or null.
 */
export async function resolvePromo(context: PromoContext): Promise<ActivePromo | null> {
  const { windowAt: at, datesAt: bookedAt } = resolutionInstants(context, new Date());
  const bookingId = context.bookingId ?? null;
  const code = normalisePromoCode(context.code);
  // Resolved once for both passes, not per candidate.
  const customer = await resolveCustomer(context);
  const dateBounds = { startAt: { lte: bookedAt }, endAt: { gt: bookedAt } };

  if (code) {
    // A failure here costs the code, never the automatic promo below it.
    const hit = await prisma.promo
      .findMany({
        where: { isActive: true, kind: "code", code, ...dateBounds },
        orderBy: PROMO_ORDER,
      })
      .then((hits) => firstEligible(hits, at, customer, bookingId))
      .catch(() => null);
    if (hit) return hit;
  }

  const autos = await prisma.promo
    .findMany({
      where: { isActive: true, kind: "automatic", ...dateBounds },
      orderBy: PROMO_ORDER,
    })
    .catch(() => []);
  return firstEligible(autos, at, customer, bookingId);
}

/**
 * The promo a booking locked in, for pricing its invoice, from the terms saved on the booking
 * (else the live row). Dates, active flag and limits aren't re-checked; the weekday/time
 * restriction still is, and the spend floor and tiers stay with the caller.
 * @param promoId - The booking's `promoIdAtBooking`.
 * @param at - The appointment instant, or null to skip the restriction (already judged).
 * @param snapshot - The booking's `promoTermsAtBooking`, when it has one.
 * @returns The promo, or null when deleted without saved terms or outside its restriction.
 */
export async function lockedInPromo(
  promoId: string,
  at: Date | null,
  snapshot?: unknown,
): Promise<ActivePromo | null> {
  const saved = isSavedPromoTerms(snapshot, promoId) ? snapshot : null;
  const terms =
    saved ??
    (await prisma.promo
      .findUnique({ where: { id: promoId } })
      .then((row) => (row ? toActivePromo(row) : null))
      .catch(() => null));
  if (!terms || (at && !matchesRecurringWindow(terms, at))) return null;
  return terms;
}

/**
 * Whether a booking's saved promo terms are usable: the same promo, with the
 * arrays the pricing helpers walk. Anything else falls back to the live row.
 * @param value - The stored JSON.
 * @param promoId - The promo id the booking names.
 * @returns True when the value can stand in for the promo.
 */
function isSavedPromoTerms(value: unknown, promoId: string): value is ActivePromo {
  if (!value || typeof value !== "object") return false;
  const terms = value as Partial<ActivePromo>;
  return terms.id === promoId && Array.isArray(terms.tiers) && Array.isArray(terms.activeWeekdays);
}

/**
 * Whether another promo already holds a code. Not a unique index: MongoDB counts a second
 * null as a duplicate, which would reject every automatic promo after the first.
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
 * Applies a promo to one hourly rate. Percent multiplies; a flat promo sets Standard and moves
 * every other home rate down by the same dollars, so pass Standard as `baseRate` for a modified rate.
 * @param rate - Pre-promo $/hr.
 * @param promo - Active promo or null.
 * @param baseRate - The undiscounted Standard rate the flat promo replaces; defaults to `rate`.
 * @returns Effective $/hr.
 */
export function applyPromoToHourlyRate(
  rate: number,
  promo: ActivePromo | null,
  baseRate: number = rate,
): number {
  if (!promo) return rate;
  // fixed_amount and free_travel act on the priced quote, not the rate.
  if (promo.discountType === "fixed_amount" || promo.discountType === "free_travel") {
    return rate;
  }
  if (promo.flatHourlyRate !== null) {
    // Never raise the price: the cut and the discounted rate both floor at zero.
    const cut = Math.max(0, baseRate - promo.flatHourlyRate);
    return roundCents(Math.max(0, rate - cut));
  }
  if (promo.percentDiscount !== null) {
    const factor = Math.max(0, 1 - promo.percentDiscount);
    return roundCents(rate * factor);
  }
  return rate;
}

/**
 * The last instant a promo applies. `endAt` is exclusive (ending Sat 31 Oct is stored as
 * Sun 1 Nov 00:00 NZ), so show this, not `endAt`.
 * @param endIso - Promo `endAt` ISO timestamp.
 * @returns One millisecond before `endAt`.
 */
export function promoLastDay(endIso: string): Date {
  return new Date(Date.parse(endIso) - 1);
}

/**
 * Friendly end-date phrase: "this Saturday" within a week, "Sat 16 May" beyond.
 * @param endIso - Promo `endAt` ISO timestamp.
 * @param now - Reference time (injected for tests).
 * @param fixedDate - Always give the date, never "this Saturday".
 * @returns Short date phrase naming the promo's last day.
 */
export function formatPromoEnd(endIso: string, now: Date = new Date(), fixedDate = false): string {
  const end = promoLastDay(endIso);
  const diffDays = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  // Within a week: anchor on weekday ("I have until Friday"). Pin to NZ time so
  // a promo ending between NZ midnight and noon isn't labelled the prior day.
  if (!fixedDate && diffDays <= 7 && diffDays > 0) {
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
 * The fraction of travel still charged under a promo (1 = full, 0 = free). Multiply
 * any travel figure by it.
 * @param promo - Active promo, or null.
 * @returns The fraction charged, 0 to 1.
 */
export function promoTravelFactor(promo: ActivePromo | null): number {
  if (!promo || promo.discountType !== "free_travel" || promo.travelPercent === null) return 1;
  return Math.min(1, Math.max(0, promo.travelPercent));
}

/**
 * The rate a modified job actually bills at under a promo, mirroring the engine. A "delta"
 * is discounted directly ($40 at 15% off = $34); an "uplift" adds to the promo, both on full
 * labour (base + 25% - 15%, not the uplifted rate x 0.85).
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
  // A flat promo cuts per hour off Standard, so it needs the Standard rate.
  if (kind === "delta" && promo.flatHourlyRate !== null) {
    return applyPromoToHourlyRate(modifierRate, promo, baseRate);
  }
  if (kind === "delta") return promoDisplayRate(modifierRate, promo);
  const discountPerHour = baseRate - promoDisplayRate(baseRate, promo);
  return roundCents(modifierRate - discountPerHour);
}

/** A crossed-out "before" figure and the one a promo leaves in its place. */
export interface PromoBeforeAfter {
  before: number;
  after: number;
}

/**
 * The hourly pair the pricing page crosses out, or null when the hourly figure is unaffected.
 * For a fixed amount it is a one-hour illustration (rate minus discount), at the operator's request.
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
    const after = Math.max(0, roundCents(baseRate - promo.fixedAmount));
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
  const after = roundCents(minTravelCharge * factor);
  return after < minTravelCharge ? { before: minTravelCharge, after } : null;
}

/**
 * What a promo gives, with no date attached - "$10 off", "Free travel". Unscoped: the banner is
 * hidden on the business page instead. Split from {@link summariseForBanner} for the pricing page.
 * @param promo - Active promo.
 * @returns The offer phrase.
 */
export function describePromoDiscount(promo: ActivePromo): string {
  // The engine ignores a tiered promo's own columns, so describe the bands, lowest first.
  if (promo.tiers.length > 0) {
    return [...promo.tiers]
      .sort((a, b) => a.minSpend - b.minSpend)
      .map(
        (tier) =>
          `${describePromoDiscount({ ...promo, ...tier, tiers: [] })} over $${tier.minSpend}`,
      )
      .join(", ");
  }
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
 * Plain-English name for a promo's recurring restriction, or null when it has none, so the
 * banner's "20% off" doesn't read as applying now. Returned bare, without "only".
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
          ? (names[0] ?? "")
          : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    }
  }

  if (!hasTime) return dayPart;
  const timePart = `${formatMinuteOfDay(window.activeFromMinute!)} to ${formatMinuteOfDay(window.activeToMinute!)}`;
  return dayPart ? `${dayPart} ${timePart}` : timePart;
}

/**
 * What a promo gives plus its spend floor - "20% off on jobs over $100" - so it doesn't
 * read as unconditional.
 * @param promo - Active promo.
 * @returns The offer phrase with its floor.
 */
export function describePromoOffer(promo: ActivePromo): string {
  // Untiered only: a tiered promo already names a floor per band.
  const floor =
    promo.minSpend != null && promo.tiers.length === 0 ? ` on jobs over $${promo.minSpend}` : "";
  return `${describePromoDiscount(promo)}${floor}`;
}

/**
 * Customer-facing one-line summary for banner + pricing hero.
 * @param promo - Active promo.
 * @param options - Formatting options.
 * @param options.fixedDate - Name the end date ("Fri, 17 Oct") instead of "this Friday",
 *   for page metadata Google may cache for days.
 * @returns Banner string.
 */
export function summariseForBanner(
  promo: ActivePromo,
  { fixedDate = false }: { fixedDate?: boolean } = {},
): string {
  const end = formatPromoEnd(promo.endAt, new Date(), fixedDate);
  const base = `${describePromoOffer(promo)} until ${end}`;
  const restriction = describeRecurringWindow(promo);
  return restriction ? `${base}, ${restriction} only` : base;
}
