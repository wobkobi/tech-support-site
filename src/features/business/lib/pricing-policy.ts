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
import { formatDateShort } from "@/shared/lib/date-format";

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

/**
 * Cancellation rules. In-person and remote are priced separately: an on-site
 * visit costs a slot plus a drive across Auckland, a remote session only costs
 * the slot, so remote gets a shorter free window and a smaller flat fee with no
 * call-out tier at all.
 */
export interface CancellationPolicy {
  /** In-person cancellations made more than this many hours before the booking are free. */
  freeNoticeHours: number;
  /** In-person cancellations made within this many hours of the booking bill fullCallOutFee plus round-trip travel (the assumed-driving window). */
  travelChargeHours: number;
  /** Flat fee for an in-person cancellation inside freeNoticeHours but outside travelChargeHours. */
  callOutFee: number;
  /** Full call-out billed for an in-person cancellation inside travelChargeHours, or on a no-show. Replaces callOutFee rather than stacking on it, and travel is added on top. */
  fullCallOutFee: number;
  /** Remote cancellations made more than this many hours before the booking are free. */
  remoteFreeNoticeHours: number;
  /** Flat fee for a remote cancellation inside remoteFreeNoticeHours, or a remote no-show. There is no drive, so no call-out tier and no travel. */
  remoteFee: number;
  /** When true, a customer self-cancel via the website auto-sends the fee invoice instead of leaving it as a draft. */
  autoSendCancellationInvoice: boolean;
}

export const CANCELLATION: CancellationPolicy = {
  freeNoticeHours: 12,
  travelChargeHours: 1,
  callOutFee: 35,
  fullCallOutFee: 65,
  remoteFreeNoticeHours: 4,
  remoteFee: 25,
  autoSendCancellationInvoice: true,
};

/** Which cancellation fee is being billed. */
export type CancellationReason = "late-cancellation" | "no-show";

/**
 * Whether the cancelled booking was on site or remote. The fee is the same
 * either way - it covers the held slot - but only an in-person booking has a
 * drive to bill, so {@link CANCELLATION.travelChargeHours} never applies to a
 * remote session.
 */
export type CancelMeetingType = "in-person" | "remote";

/** What a cancellation actually bills, once the policy has been applied. */
export interface CancellationCharge {
  /** Fee in NZD; 0 when the cancel was made with enough notice to be free. */
  fee: number;
  /** True when the round trip is billed on top of the fee. */
  travelApplies: boolean;
  /** True when the cancel earned the full call-out rather than the flat late fee. */
  isFullCallOut: boolean;
}

/**
 * Applies the cancellation policy to one booking. Single source of truth for
 * which tier a cancel lands in, shared by the customer/operator auto-draft and
 * the calculator's cancel mode so they cannot drift apart.
 *
 * In person, three tiers: outside freeNoticeHours is free; inside it bills the
 * flat callOutFee; inside travelChargeHours (or a no-show, where the client
 * never called at all) bills the full call-out instead, plus the round trip.
 *
 * Remote is its own two-tier rule, not a discount on the in-person one: outside
 * remoteFreeNoticeHours is free, inside it (or a no-show) bills the flat
 * remoteFee. There is no drive, so no call-out tier and no travel however late
 * it is dropped.
 *
 * A no-show never called, so there is no notice to measure - it always lands in
 * the charged tier.
 * @param bookingStart - When the booking was due to start.
 * @param cancelledAt - When the client called it off; ignored for a no-show.
 * @param options - Booking shape.
 * @param options.reason - Late cancellation or no-show.
 * @param options.meetingType - On site or remote.
 * @param options.policy - Live policy (defaults to the module constant).
 * @returns The fee, whether travel is added, and which tier applied.
 */
export function assessCancellation(
  bookingStart: Date,
  cancelledAt: Date,
  options: {
    reason: CancellationReason;
    meetingType: CancelMeetingType;
    policy?: CancellationPolicy;
  },
): CancellationCharge {
  const p = options.policy ?? CANCELLATION;
  const noShow = options.reason === "no-show";

  if (options.meetingType === "remote") {
    const charged =
      noShow || isWithinCancellationWindow(bookingStart, cancelledAt, p.remoteFreeNoticeHours);
    return { fee: charged ? p.remoteFee : 0, travelApplies: false, isFullCallOut: false };
  }

  const feeApplies =
    noShow || isWithinCancellationWindow(bookingStart, cancelledAt, p.freeNoticeHours);
  if (!feeApplies) return { fee: 0, travelApplies: false, isFullCallOut: false };

  const isFullCallOut =
    noShow || isWithinTravelWindow(bookingStart, cancelledAt, p.travelChargeHours);
  return {
    fee: isFullCallOut ? p.fullCallOutFee : p.callOutFee,
    travelApplies: isFullCallOut,
    isFullCallOut,
  };
}

/**
 * Invoice line wording for a cancellation fee. Shared by the automated
 * booking-cancel draft and the calculator's cancel mode so the two cannot drift
 * apart.
 * @param reason - Which fee this is.
 * @param date - The cancelled booking's original start.
 * @returns Line description, e.g. "Late cancellation fee - 15 Jul 2026".
 */
export function cancellationFeeLabel(reason: CancellationReason, date: Date | string): string {
  const when = formatDateShort(date);
  return reason === "no-show" ? `No-show fee - ${when}` : `Late cancellation fee - ${when}`;
}

/**
 * Customer-facing invoice note for a cancellation fee.
 * @param reason - Which fee this is.
 * @param date - The cancelled booking's original start.
 * @returns Note text written onto the invoice.
 */
export function cancellationNotes(reason: CancellationReason, date: Date | string): string {
  const when = formatDateShort(date);
  return reason === "no-show"
    ? `Charge for missing the appointment originally booked for ${when}.`
    : `Late cancellation fee for the appointment originally booked for ${when}.`;
}

export interface TravelChargeBreakdown {
  /** Raw round-trip cost before any rounding or floor: ((thereMins + backMins)/60) * ratePerHour. */
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
 * Each leg is quoted at its own departure time (out at job start, back at job
 * end); callers with only one figure pass it for both legs, which reproduces
 * the old symmetric doubling. Returns zeros for no travel (remote, or
 * geocoded to origin).
 * @param thereMins - Outbound drive time in minutes.
 * @param backMins - Return drive time in minutes; pass thereMins again when no separate figure exists.
 * @param travelRatePerHour - Travel hourly rate, sourced from the `Travel` RateConfig.
 * @param minTravelCharge - Travel floor (live pricing setting); defaults to the code const.
 * @returns Per-step breakdown of the round-trip charge.
 */
export function breakdownTravelCharge(
  thereMins: number,
  backMins: number,
  travelRatePerHour: number,
  minTravelCharge: number = MIN_TRAVEL_CHARGE,
): TravelChargeBreakdown {
  if (thereMins + backMins <= 0 || travelRatePerHour <= 0) {
    return { rawCost: 0, roundedCost: 0, finalCost: 0, minimumApplied: false };
  }
  const rawCost = Math.round(((thereMins + backMins) / 60) * travelRatePerHour * 100) / 100;
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
 * Round-trip travel charge: sums both legs, snaps to $5, and floors at
 * {@link MIN_TRAVEL_CHARGE}. Returns 0 for no travel (remote, or geocoded
 * to origin) so the floor doesn't invent a charge.
 * @param thereMins - Outbound drive time in minutes.
 * @param backMins - Return drive time in minutes; pass thereMins again when no separate figure exists.
 * @param travelRatePerHour - Travel hourly rate, sourced from the `Travel` RateConfig.
 * @param minTravelCharge - Travel floor (live pricing setting); defaults to the code const.
 * @returns Charge in NZD (whole dollars after $5 rounding), or 0 when no travel.
 */
export function calcTravelCharge(
  thereMins: number,
  backMins: number,
  travelRatePerHour: number,
  minTravelCharge: number = MIN_TRAVEL_CHARGE,
): number {
  return breakdownTravelCharge(thereMins, backMins, travelRatePerHour, minTravelCharge).finalCost;
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

/** Hard ceiling for a single job's billable minutes (8h). Shared by both AI routes. */
export const MAX_JOB_MINS = 8 * 60;

/**
 * Snaps to the nearest billing increment, applies the minimum-billable floor,
 * then optionally caps at a ceiling. The snap+floor is identical to
 * {@link floorBillableMins} for any positive input; unlike it, a zero/negative
 * raw value floors to the minimum (not 0) - mirroring the AI estimate route's
 * clamp - and an optional ceiling caps a genuinely huge figure. Shared by the
 * public estimate route and the admin job parser so both bill identically.
 * @param rawMins - Raw duration in minutes (may be 0 or negative).
 * @param minBillableMins - Minimum billable floor (live setting; defaults to the const).
 * @param incrementMins - Rounding increment (live setting; defaults to the const).
 * @param ceilingMins - Optional hard cap (e.g. {@link MAX_JOB_MINS}); omit for no ceiling.
 * @returns Billable minutes after snap, floor, and optional ceiling.
 */
export function clampBillableMins(
  rawMins: number,
  minBillableMins: number = MIN_BILLABLE_MINS,
  incrementMins: number = BILLING_INCREMENT_MINS,
  ceilingMins?: number,
): number {
  const snapped = billableMins(Math.max(0, rawMins), incrementMins);
  const floored = Math.max(minBillableMins, snapped);
  return ceilingMins != null ? Math.min(ceilingMins, floored) : floored;
}

// > Copy generators
// Generators take their variable inputs explicitly so the rendered text
// always matches the live values. Key figures are wrapped in `**…**` so the
// pricing page can emit `<strong>` while emails / FAQs pass the markers
// through as plain-text emphasis.

/**
 * Renders an hour count for customer-facing copy. The windows are settings, so
 * a value of 1 is reachable and "1 hours" would read as a bug to a client.
 * @param n - Number of hours.
 * @returns e.g. "1 hour", "12 hours".
 */
function hours(n: number): string {
  return `${n} hour${n === 1 ? "" : "s"}`;
}

/**
 * Cancellation policy text (pricing accordion + booking emails + cancel page).
 * @param p - Cancellation policy (defaults to the module constant).
 * @param opts - Optional narrowing for a context that knows the meeting type.
 * @param opts.only - Show just this tier; omit to show both (the general case).
 * @returns Multi-line copy describing the cancellation rules.
 */
export function cancellationCopy(
  p: CancellationPolicy = CANCELLATION,
  opts?: { only?: "in_person" | "remote" },
): string {
  const inPerson =
    `**In-person visits:** free if cancelled at least **${hours(p.freeNoticeHours)}** before your ` +
    `appointment. Inside that window, a **$${p.callOutFee} cancellation fee** applies. If ` +
    `cancelled within **${hours(p.travelChargeHours)}** of the appointment (when I would already ` +
    `be on the way), or if nobody is there when I arrive, the full **$${p.fullCallOutFee} ` +
    `call-out** applies plus **round-trip travel**.`;
  const remote =
    `**Remote sessions:** free if cancelled at least **${hours(p.remoteFreeNoticeHours)}** before ` +
    `your appointment. Inside that window, or if you are not there, a **$${p.remoteFee} fee** ` +
    `applies.`;
  const closing = `Please cancel using the link in your confirmation email, or by phone or text.`;

  // A booking already knows which kind it is, so a confirmation email can show
  // just the tier that binds this customer. Pages that describe the policy in
  // general (pricing, FAQ) pass nothing and get both.
  const tiers =
    opts?.only === "in_person"
      ? [inPerson]
      : opts?.only === "remote"
        ? [remote]
        : [inPerson, remote];

  return [...tiers, closing].join("\n\n");
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
