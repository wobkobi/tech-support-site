// src/features/business/lib/pricing-policy.ts
/**
 * @file pricing-policy.ts
 * @description Single source of truth for every billable rule customers and
 * operators see: travel-charge math, cancellation windows, minimum billable
 * time, GST mode, plus the copy shared by the pricing page, booking
 * confirmation emails, and the FAQ.
 *
 * Designed to migrate later to a DB-backed Setting table without rewriting
 * call sites: every consumer reads `(await getPolicy()).X` or one of the
 * copy generators, so swapping the sync constants for a `prisma.setting`
 * query is a single-file change. Keep this module client-safe (no Prisma).
 */

import { MIN_TRAVEL_CHARGE, billableMins } from "@/features/business/lib/business";

export { MIN_TRAVEL_CHARGE };

/** GST is back-calculated from the inclusive total via calcGstFromInclusive when enabled. */
export const GST_RATE = 0.15;

/**
 * When false (today) every invoice prints with no GST line. When flipped to
 * true (future, once registration crosses the $60k threshold) displayed
 * rates are treated as GST-inclusive; the invoice shows an "Includes GST of
 * $X" line via back-calc. Flip this single flag and also set the
 * BUSINESS_GST_NUMBER env var so the invoice header switches to "TAX INVOICE".
 */
export const GST_REGISTERED = false;

/** 15-minute floor; matches BILLING_INCREMENT_MINS so floor + round don't double-snap. */
export const MIN_BILLABLE_MINS = 15;

/** Round-up step for billable time; mirrors billableMins in business.ts. */
export const BILLING_INCREMENT_MINS = 15;

/** Multiplier applied to labour on NZ public holidays. Travel and parts are not uplifted. */
export const PUBLIC_HOLIDAY_UPLIFT = 0.25;

export interface CancellationPolicy {
  /** Cancellations made more than this many hours before the booking are free. */
  freeNoticeHours: number;
  /** Cancellations made within this many hours of the booking add the travel charge on top of the call-out fee (assumed-driving window). */
  travelChargeHours: number;
  /** Flat fee applied when a cancellation lands inside freeNoticeHours. */
  callOutFee: number;
}

export const CANCELLATION: CancellationPolicy = {
  freeNoticeHours: 12,
  travelChargeHours: 2,
  callOutFee: 30,
};

/**
 * Round-trip travel charge. Doubles one-way drive time, snaps to $5, and
 * floors at MIN_TRAVEL_CHARGE. Returns 0 for no travel (remote, or geocoded
 * to origin) so the floor doesn't invent a charge.
 *
 * Pass ONE-WAY travelMins; this doubles internally. Passing round-trip
 * minutes would 4x the bill.
 * @param travelMins - One-way drive time in minutes (from `lookupDriveDistance`).
 * @param travelRatePerHour - Travel hourly rate, sourced from the `Travel` RateConfig.
 * @returns Charge in NZD (whole dollars after $5 rounding), or 0 when no travel.
 */
export function calcTravelCharge(travelMins: number, travelRatePerHour: number): number {
  if (travelMins <= 0 || travelRatePerHour <= 0) return 0;
  const raw = (travelMins / 60) * 2 * travelRatePerHour;
  const roundedToFive = Math.round(raw / 5) * 5;
  return Math.max(MIN_TRAVEL_CHARGE, roundedToFive);
}

/**
 * True when cancelling now would trigger the $30 call-out fee. Compared
 * against server clock so a skewed client cannot argue around the boundary.
 * @param bookingStart - The booking's startAt.
 * @param now - Reference time (defaults to current time).
 * @returns True when the booking is less than freeNoticeHours away.
 */
export function isWithinCancellationWindow(bookingStart: Date, now: Date = new Date()): boolean {
  const msUntil = bookingStart.getTime() - now.getTime();
  return msUntil < CANCELLATION.freeNoticeHours * 60 * 60 * 1000;
}

/**
 * True when cancelling now would also add round-trip travel on top of the
 * call-out fee (the assumed-driving window).
 * @param bookingStart - The booking's startAt.
 * @param now - Reference time (defaults to current time).
 * @returns True when the booking is less than travelChargeHours away.
 */
export function isWithinTravelWindow(bookingStart: Date, now: Date = new Date()): boolean {
  const msUntil = bookingStart.getTime() - now.getTime();
  return msUntil < CANCELLATION.travelChargeHours * 60 * 60 * 1000;
}

/**
 * Applies the 15-minute floor then rounds up to the next 15-minute increment.
 * 0 stays 0 (no work, no charge) so a placeholder job does not invent time.
 * @param rawMins - Actual worked minutes.
 * @returns Billable minutes after the floor.
 */
export function floorBillableMins(rawMins: number): number {
  if (rawMins <= 0) return 0;
  return Math.max(MIN_BILLABLE_MINS, billableMins(rawMins));
}

// > Copy generators
// Generators take their variable inputs explicitly so the rendered text
// always matches the live values. Key figures are wrapped in `**…**` so the
// pricing page can emit `<strong>` while emails / FAQs pass the markers
// through as plain-text emphasis.

/**
 * Cancellation policy text (pricing accordion + booking emails + cancel page).
 * @param p - Cancellation policy (defaults to the module constant).
 * @returns Multi-line copy describing the cancellation rules.
 */
export function cancellationCopy(p: CancellationPolicy = CANCELLATION): string {
  return (
    `**Free** if cancelled at least **${p.freeNoticeHours} hours** before your appointment. ` +
    `Inside that window, a **$${p.callOutFee} call-out fee** applies. ` +
    `If cancelled within **${p.travelChargeHours} hours** of the appointment ` +
    `(when I would already be on the way), the fee also includes **round-trip travel**.`
  );
}

/**
 * Two-test definition for "unsuccessful" so neither party can argue it.
 * @returns Multi-paragraph copy describing the half-price rule.
 */
export function unsuccessfulWorkCopy(): string {
  return (
    "Two outcomes count as a successful visit, charged at the agreed rate:\n\n" +
    "1. **Fixed**: the issue described no longer reproduces by the end of the visit.\n" +
    "2. **Diagnosed**: I leave you with a written explanation of the root cause and what would be needed to resolve it (for example, 'your hard drive is failing - here is the data recovery specialist you will need to use').\n\n" +
    "**Half price** applies only when I leave with neither - the symptom is still happening AND I cannot tell you why. Remote sessions are **free** in that case.\n\n" +
    "A partial fix counts as a fix. A confirmed external blocker (for example, 'you need a part from the manufacturer, here is the part number') counts as a diagnosis."
  );
}

/**
 * Travel-policy text. Caller passes the live Travel rate so the page always
 * quotes the figure the operator is actually billing.
 * @param travelRatePerHour - Current Travel rate from the RateConfig row.
 * @returns Copy describing the travel charge model.
 */
export function travelCopy(travelRatePerHour: number): string {
  return (
    `Travel is **one round trip** billed at **$${travelRatePerHour}/h** - a separate, ` +
    `lower rate than labour. ` +
    `**Minimum $${MIN_TRAVEL_CHARGE}** when there is any travel at all. ` +
    `If a job runs long and needs a second visit, **that second trip is on me**.`
  );
}

/**
 * Minimum-charge text used on the pricing page accordion.
 * @returns Copy describing the minimum billable time.
 */
export function minimumsCopy(): string {
  return (
    `**${MIN_BILLABLE_MINS} minutes minimum** on anything billable, then ` +
    `**${BILLING_INCREMENT_MINS}-minute increments** after that. ` +
    `Quick calls and emails stay **free** - a "remote session" is when I log in ` +
    `and start working on your machine.`
  );
}

/**
 * Public-holiday surcharge text.
 * @param uplift - Surcharge multiplier (defaults to the module constant).
 * @returns Copy describing the stat-day surcharge.
 */
export function publicHolidayCopy(uplift: number = PUBLIC_HOLIDAY_UPLIFT): string {
  return (
    `Available on NZ public holidays; a **${Math.round(uplift * 100)}% surcharge** ` +
    `applies to labour. **Travel and parts are unchanged.**`
  );
}

/**
 * GST disclosure text. Reads either the flag default or an explicit override.
 * @param registered - GST-registration state (defaults to the module constant).
 * @returns Copy describing the GST stance.
 */
export function gstCopy(registered: boolean = GST_REGISTERED): string {
  return registered
    ? "Prices **include 15% GST**. The price you see is the price you pay; the invoice shows the GST breakdown."
    : "**Not GST registered.** The price you see is the price you pay.";
}

export interface Policy {
  GST_REGISTERED: boolean;
  GST_RATE: number;
  MIN_TRAVEL_CHARGE: number;
  MIN_BILLABLE_MINS: number;
  BILLING_INCREMENT_MINS: number;
  PUBLIC_HOLIDAY_UPLIFT: number;
  CANCELLATION: CancellationPolicy;
}

/**
 * Forward-looking accessor that bundles every policy value. Async so a
 * future swap to a `prisma.setting.findMany()` backing doesn't break
 * consumers - they `(await getPolicy()).CANCELLATION.callOutFee` already.
 * @returns Current policy values.
 */
export async function getPolicy(): Promise<Policy> {
  return {
    GST_REGISTERED,
    GST_RATE,
    MIN_TRAVEL_CHARGE,
    MIN_BILLABLE_MINS,
    BILLING_INCREMENT_MINS,
    PUBLIC_HOLIDAY_UPLIFT,
    CANCELLATION,
  };
}
