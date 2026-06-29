// src/features/business/lib/pricing-policy.ts
/**
 * @description Single source of truth for every billable rule customers and
 * operators see: travel-charge math, cancellation windows, minimum billable
 * time, GST mode, plus the copy shared by the pricing page, booking
 * confirmation emails, and the FAQ.
 *
 * The constants here are the DEFAULTS. The live, settings-backed values are
 * resolved by `getPolicy()` in `pricing-policy.server.ts`; server consumers
 * read `(await getPolicy()).X` and client consumers receive resolved values as
 * props. The copy generators take their figures as arguments so the rendered
 * text always matches the live policy. Keep this module client-safe (no Prisma).
 */

import { MIN_TRAVEL_CHARGE, billableMins } from "@/features/business/lib/business";

export { MIN_TRAVEL_CHARGE };

/** GST is back-calculated from the inclusive total via calcGstFromInclusive when enabled. */
export const GST_RATE = 0.15;

/**
 * When false (today) every invoice prints with no GST line. When flipped to
 * true (future, once registration crosses the $60k threshold) displayed
 * rates are treated as GST-inclusive; the invoice shows an "Includes GST of
 * $X" line via back-calc. The live flag comes from the pricing settings; set
 * the GST number in the identity settings so the invoice header switches to
 * "TAX INVOICE".
 */
export const GST_REGISTERED = false;

/** Minimum charge once any billable work happens; 15 is a multiple of BILLING_INCREMENT_MINS so the floor + round don't double-snap. */
export const MIN_BILLABLE_MINS = 15;

/** Round-to-nearest step for billable time; mirrors {@link billableMins} in business.ts. */
export const BILLING_INCREMENT_MINS = 5;

/** Multiplier applied to labour on NZ public holidays. Travel and parts are not uplifted. */
export const PUBLIC_HOLIDAY_UPLIFT = 0.25;

/** Fallback Standard base rate ($/hr) when no default hourly RateConfig row exists; mirrors the seed default. */
export const FALLBACK_BASE_RATE = 65;
/** Fallback travel rate ($/hr) when no `travel-hour` RateConfig row exists; mirrors the seed default. */
export const FALLBACK_TRAVEL_RATE = 40;

/** Region label for nationwide NZ public holidays in the PublicHoliday table. */
export const NZ_REGION = "NZ";
/** Region for the operator's regional anniversary day (also charged the uplift). */
export const HOME_REGION = "Auckland";

/**
 * Formats a Date as a Pacific/Auckland-local YYYY-MM-DD so booking timestamps
 * match the `PublicHoliday.date` strings (always NZ-local).
 * @param d - Date instance to format.
 * @returns ISO-style date string in NZ-local time.
 */
export function nzDateKey(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${year}-${month}-${day}`;
}

export interface CancellationPolicy {
  /** Cancellations made more than this many hours before the booking are free. */
  freeNoticeHours: number;
  /** Cancellations made within this many hours of the booking add the travel charge on top of the call-out fee (assumed-driving window). */
  travelChargeHours: number;
  /** Flat fee applied when a cancellation lands inside freeNoticeHours. */
  callOutFee: number;
  /** When true, a customer self-cancel via the website auto-sends the fee invoice instead of leaving it as a draft. */
  autoSendCancellationInvoice: boolean;
}

export const CANCELLATION: CancellationPolicy = {
  freeNoticeHours: 12,
  travelChargeHours: 2,
  callOutFee: 30,
  autoSendCancellationInvoice: true,
};

export interface TravelChargeBreakdown {
  /** Raw round-trip cost before any rounding or floor: (oneWayMins/60) * 2 * ratePerHour. */
  rawCost: number;
  /** rawCost snapped to the nearest $5. */
  roundedCost: number;
  /** Final billed cost after the MIN_TRAVEL_CHARGE floor is applied. */
  finalCost: number;
  /** True when finalCost was lifted up to MIN_TRAVEL_CHARGE. */
  minimumApplied: boolean;
}

/**
 * Step-by-step travel-charge math. Single source of truth for both
 * {@link calcTravelCharge} and the operator-side breakdown display, so the
 * displayed math always matches what's billed.
 *
 * Pass ONE-WAY travelMins; this doubles internally to produce the round-trip
 * charge. Returns zeros for no travel (remote, or geocoded to origin).
 * @param travelMins - One-way drive time in minutes (from `lookupDriveDistance`).
 * @param travelRatePerHour - Travel hourly rate, sourced from the `Travel` RateConfig.
 * @param minTravelCharge - Travel floor (live pricing setting); defaults to the code const.
 * @returns Per-step breakdown of the round-trip charge.
 */
export function breakdownTravelCharge(
  travelMins: number,
  travelRatePerHour: number,
  minTravelCharge: number = MIN_TRAVEL_CHARGE,
): TravelChargeBreakdown {
  if (travelMins <= 0 || travelRatePerHour <= 0) {
    return { rawCost: 0, roundedCost: 0, finalCost: 0, minimumApplied: false };
  }
  const rawCost = Math.round((travelMins / 60) * 2 * travelRatePerHour * 100) / 100;
  const roundedCost = Math.round(rawCost / 5) * 5;
  const finalCost = Math.max(minTravelCharge, roundedCost);
  return {
    rawCost,
    roundedCost,
    finalCost,
    minimumApplied: roundedCost < minTravelCharge,
  };
}

/**
 * Round-trip travel charge. Doubles one-way drive time, snaps to $5, and
 * floors at {@link MIN_TRAVEL_CHARGE}. Returns 0 for no travel (remote, or geocoded
 * to origin) so the floor doesn't invent a charge.
 *
 * Pass ONE-WAY travelMins; this doubles internally. Passing round-trip
 * minutes would 4x the bill.
 * @param travelMins - One-way drive time in minutes (from `lookupDriveDistance`).
 * @param travelRatePerHour - Travel hourly rate, sourced from the `Travel` RateConfig.
 * @param minTravelCharge - Travel floor (live pricing setting); defaults to the code const.
 * @returns Charge in NZD (whole dollars after $5 rounding), or 0 when no travel.
 */
export function calcTravelCharge(
  travelMins: number,
  travelRatePerHour: number,
  minTravelCharge: number = MIN_TRAVEL_CHARGE,
): number {
  return breakdownTravelCharge(travelMins, travelRatePerHour, minTravelCharge).finalCost;
}

/**
 * True when cancelling now would trigger the call-out fee. Compared against
 * server clock so a skewed client cannot argue around the boundary.
 * @param bookingStart - The booking's startAt.
 * @param now - Reference time (defaults to current time).
 * @param freeNoticeHours - Live free-notice window (defaults to the constant).
 * @returns True when the booking is less than freeNoticeHours away.
 */
export function isWithinCancellationWindow(
  bookingStart: Date,
  now: Date = new Date(),
  freeNoticeHours: number = CANCELLATION.freeNoticeHours,
): boolean {
  const msUntil = bookingStart.getTime() - now.getTime();
  return msUntil < freeNoticeHours * 60 * 60 * 1000;
}

/**
 * True when cancelling now would also add round-trip travel on top of the
 * call-out fee (the assumed-driving window).
 * @param bookingStart - The booking's startAt.
 * @param now - Reference time (defaults to current time).
 * @param travelChargeHours - Live travel-charge window (defaults to the constant).
 * @returns True when the booking is less than travelChargeHours away.
 */
export function isWithinTravelWindow(
  bookingStart: Date,
  now: Date = new Date(),
  travelChargeHours: number = CANCELLATION.travelChargeHours,
): boolean {
  const msUntil = bookingStart.getTime() - now.getTime();
  return msUntil < travelChargeHours * 60 * 60 * 1000;
}

/**
 * Rounds to the nearest billing increment then applies the minimum-billable
 * floor. 0 stays 0 (no work, no charge) so a placeholder job does not invent
 * time. Both bounds default to the code constants but accept the live pricing
 * settings so callers (calculator, job parser) stay consistent.
 * @param rawMins - Actual worked minutes.
 * @param minBillableMins - Minimum billable floor (live setting; defaults to the const).
 * @param incrementMins - Rounding increment (live setting; defaults to the const).
 * @returns Billable minutes after the floor.
 */
export function floorBillableMins(
  rawMins: number,
  minBillableMins: number = MIN_BILLABLE_MINS,
  incrementMins: number = BILLING_INCREMENT_MINS,
): number {
  if (rawMins <= 0) return 0;
  return Math.max(minBillableMins, billableMins(rawMins, incrementMins));
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
 * @param minTravelCharge - Live minimum travel charge (defaults to the constant).
 * @returns Copy describing the travel charge model.
 */
export function travelCopy(
  travelRatePerHour: number,
  minTravelCharge: number = MIN_TRAVEL_CHARGE,
): string {
  return (
    `Travel is **one round trip** billed at **$${travelRatePerHour}/hr** - a separate, ` +
    `lower rate than labour. ` +
    `**Minimum $${minTravelCharge}** when there is any travel at all. ` +
    `If a job runs long and needs a second visit, **that second trip is on me**.`
  );
}

/**
 * Minimum-charge text used on the pricing page accordion.
 * @param minBillableMins - Live minimum billable time (defaults to the constant).
 * @param billingIncrementMins - Live rounding increment (defaults to the constant).
 * @returns Copy describing the minimum billable time.
 */
export function minimumsCopy(
  minBillableMins: number = MIN_BILLABLE_MINS,
  billingIncrementMins: number = BILLING_INCREMENT_MINS,
): string {
  return (
    `**${minBillableMins} minutes minimum** on anything billable, then ` +
    `**${billingIncrementMins}-minute increments** after that. ` +
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

/**
 * Bundle of every policy value. The constants in this module are the DEFAULTS;
 * the live, settings-backed values are resolved by `getPolicy()` in
 * `pricing-policy.server.ts`. Defined as a type (not an eager const) so this
 * client-safe module never reads its cross-module constants at evaluation time -
 * {@link MIN_TRAVEL_CHARGE} comes from business.ts, which imports back from here, so an
 * eager read would hit the circular-import temporal dead zone.
 */
export interface Policy {
  GST_REGISTERED: boolean;
  GST_RATE: number;
  MIN_TRAVEL_CHARGE: number;
  MIN_BILLABLE_MINS: number;
  BILLING_INCREMENT_MINS: number;
  PUBLIC_HOLIDAY_UPLIFT: number;
  CANCELLATION: CancellationPolicy;
}
