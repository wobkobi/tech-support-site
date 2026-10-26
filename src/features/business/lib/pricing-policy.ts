// src/features/business/lib/pricing-policy.ts
// Billable rules (travel, cancellation, minimums, GST) and their shared customer copy.
// Constants are DEFAULTS; live values come from getPolicy() in pricing-policy.server.ts. Client-safe (no Prisma).

import {
  MIN_TRAVEL_CHARGE,
  billableMins,
  formatMoneyCompact,
} from "@/features/business/lib/business";
import { formatDateShort } from "@/shared/lib/date-format";
import { roundCents } from "@/shared/lib/money";
import { DEFAULT_SETTINGS } from "@/shared/lib/settings/defaults";

/** GST is back-calculated from the inclusive total via calcGstFromInclusive when enabled. */
export const GST_RATE = 0.15;

/**
 * Default GST flag. When true, rates are GST-inclusive and invoices show an "Includes GST"
 * line; the live flag is a pricing setting, and the identity GST number makes it a "TAX INVOICE".
 */
export const GST_REGISTERED = false;

/** Minimum a WHOLE job bills (not per task); a multiple of BILLING_INCREMENT_MINS so floor + round don't double-snap. */
export const MIN_BILLABLE_MINS = 15;

/** Round-to-nearest step for billable time; mirrors {@link billableMins} in business.ts. */
export const BILLING_INCREMENT_MINS = 5;

/** Multiplier applied to labour on NZ public holidays. Travel and parts are not uplifted. */
const PUBLIC_HOLIDAY_UPLIFT = 0.25;

/** Multiplier applied to labour on an NZ Saturday or Sunday. Travel and parts are not uplifted. */
const WEEKEND_UPLIFT = 0.1;

/** Fallback fraction charged for an unsuccessful visit (0.5 = half price). */
const UNSUCCESSFUL_WORK_FACTOR = 0.5;
/** Fallback grace period (minutes) covered free at the start of a visit returning to finish an unfixed job. */
const NO_FIX_FREE_MINS = 30;

/** Fallback workmanship-guarantee window (days): fallout from a prior visit's changes is fixed free inside it. */
const WORKMANSHIP_WINDOW_DAYS = 30;

/** Fallback gap (minutes) under which the calculator offers to bill two same-day events as one job. */
export const MERGE_SUGGEST_GAP_MINS = 90;

/** Fallback Standard base rate ($/hr) when no default hourly RateConfig row exists; mirrors the seed default. */
export const FALLBACK_BASE_RATE = 65;

/** Fallback Business modifier ($/hr on top of the base rate) when no Business RateConfig row exists; mirrors the seed default. */
export const FALLBACK_BUSINESS_DELTA = 20;

/**
 * Default RateConfig rows, seeded by the rates route when a label is missing: Standard plus
 * $/hr and percentage modifiers. Standard and Business read the fallbacks above so they agree.
 */
export const DEFAULT_RATE_ROWS = [
  {
    label: "Standard",
    ratePerHour: FALLBACK_BASE_RATE,
    flatRate: null,
    hourlyDelta: null,
    percentDelta: null,
    unit: "hour",
    isDefault: true,
  },
  {
    // Company on-site work; shown on /business, kept off the consumer pricing accordion.
    label: "Business",
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: FALLBACK_BUSINESS_DELTA,
    percentDelta: null,
    unit: "modifier",
    isDefault: false,
  },
  {
    label: "At home",
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: -15,
    percentDelta: null,
    unit: "modifier",
    isDefault: false,
  },
  {
    label: "Remote",
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: -10,
    percentDelta: null,
    unit: "modifier",
    isDefault: false,
  },
  {
    // Phone work, cheaper than Remote; for calls long enough to bill.
    label: "Phone",
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: -25,
    percentDelta: null,
    unit: "modifier",
    isDefault: false,
  },
  {
    // The row only surfaces the modifier; the charged uplift is the pricing
    // setting, so the seed takes its default from there.
    label: "Public Holiday",
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: null,
    percentDelta: DEFAULT_SETTINGS.pricing.publicHolidayUplift,
    unit: "modifier",
    isDefault: false,
  },
];

/** Region label for nationwide NZ public holidays in the PublicHoliday table. */
export const NZ_REGION = "NZ";
/** Region for the operator's regional anniversary day (also charged the uplift). */
export const HOME_REGION = "Auckland";

/**
 * Cancellation rules. Remote only costs the slot (no drive), so it gets a shorter free
 * window, a smaller flat fee and no call-out tier.
 */
export interface CancellationPolicy {
  /** In-person cancellations made more than this many hours before the booking are free. */
  freeNoticeHours: number;
  /** In-person cancellations made within this many hours of the booking bill fullCallOutFee plus round-trip travel (the assumed-driving window). */
  travelChargeHours: number;
  /** Flat fee for an in-person cancellation inside freeNoticeHours but outside travelChargeHours. */
  callOutFee: number;
  /** Full call-out for an in-person cancellation inside travelChargeHours or a no-show; replaces callOutFee, plus travel. */
  fullCallOutFee: number;
  /** Remote cancellations made more than this many hours before the booking are free. */
  remoteFreeNoticeHours: number;
  /** Flat fee for a remote cancellation inside remoteFreeNoticeHours or a remote no-show; never travel. */
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
 * Whether the cancelled booking was on site or remote; only in-person has a drive, so
 * {@link CANCELLATION.travelChargeHours} never applies to remote.
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
 * Applies the cancellation policy to one booking. In person: free, then callOutFee, then full
 * call-out plus travel inside travelChargeHours. Remote: free or remoteFee. No-shows always pay.
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
 * Invoice line wording for a cancellation fee, shared by the auto-draft and the calculator.
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
 * Step-by-step travel-charge math behind {@link calcTravelCharge} and the operator breakdown,
 * so both match. Returns zeros for no travel (remote, or geocoded to origin).
 * @param thereMins - Outbound drive time in minutes.
 * @param backMins - Return drive time in minutes; pass thereMins again when no separate figure exists.
 * @param travelRatePerHour - Travel hourly rate, sourced from the pricing settings.
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
  const rawCost = roundCents(((thereMins + backMins) / 60) * travelRatePerHour);
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
 * @param travelRatePerHour - Travel hourly rate, sourced from the pricing settings.
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
 * Snaps to the billing increment, applies the minimum floor (even to 0), then optionally caps.
 * Shared by the public estimate route and the admin job parser.
 * @param rawMins - Raw duration in minutes (may be 0 or negative).
 * @param minBillableMins - Minimum billable floor (live setting; defaults to the const).
 * @param incrementMins - Rounding increment (live setting; defaults to the const).
 * @param ceilingMins - Optional hard cap (pass the live `maxJobMins`); omit for no ceiling.
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
// Figures are passed in so text matches live values; `**…**` marks bold for the pricing page.

/**
 * Renders an hour count for customer-facing copy, singular at 1.
 * @param n - Number of hours.
 * @returns e.g. "1 hour", "12 hours".
 */
function hours(n: number): string {
  return `${n} hour${n === 1 ? "" : "s"}`;
}

/**
 * Renders a day count for customer-facing copy, singular at 1.
 * @param n - Number of days.
 * @returns e.g. "1 day", "30 days".
 */
function days(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

/**
 * Renders a minute count for customer-facing copy, as hours when whole ("1 hour", not "60 minutes").
 * @param n - Number of minutes.
 * @returns e.g. "30 minutes", "1 hour", "90 minutes".
 */
function minutes(n: number): string {
  return n % 60 === 0 ? hours(n / 60) : `${n} minute${n === 1 ? "" : "s"}`;
}

/**
 * The three in-person cancellation tiers as a short inline list, for the FAQ
 * line that tells people the cancel page shows which tier they are in.
 * @param p - Cancellation policy (defaults to the module constant).
 * @returns e.g. "free / $35 cancellation fee / $65 late-cancellation fee + travel".
 */
export function cancellationTiersCopy(p: CancellationPolicy = CANCELLATION): string {
  return `free / $${p.callOutFee} cancellation fee / $${p.fullCallOutFee} late-cancellation fee + travel`;
}

/**
 * FAQ answer for a missed appointment. A no-show bills like a cancel inside travelChargeHours,
 * so only notice beyond that window avoids travel.
 * @param p - Cancellation policy (defaults to the module constant).
 * @returns The charge sentence and the how-to-avoid-it sentence.
 */
export function noShowCopy(p: CancellationPolicy = CANCELLATION): {
  charge: string;
  notice: string;
} {
  return {
    charge:
      `A missed in-person appointment is billed like a cancellation inside ` +
      `${hours(p.travelChargeHours)}: the $${p.fullCallOutFee} late-cancellation fee plus the round-trip ` +
      `travel I would have made to your address. A missed remote session is the $${p.remoteFee} ` +
      `remote fee.`,
    notice:
      `If you realise you can't make it, let me know as soon as you can. With more than ` +
      `${hours(p.travelChargeHours)} notice it drops to the $${p.callOutFee} cancellation fee ` +
      `with no travel, and with ${hours(p.freeNoticeHours)} or more there's no fee at all.`,
  };
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
    `be on the way), or if nobody is there when I arrive, a **$${p.fullCallOutFee} ` +
    `late-cancellation fee** applies instead, plus **round-trip travel**.`;
  const remote =
    `**Remote sessions:** free if cancelled at least **${hours(p.remoteFreeNoticeHours)}** before ` +
    `your appointment. Inside that window, or if you are not there, a **$${p.remoteFee} fee** ` +
    `applies.`;
  const closing = `Please cancel using the link in your confirmation email, or by phone or text.`;

  // A booking's emails show just its own tier; general pages (pricing, FAQ) get both.
  const tiers =
    opts?.only === "in_person"
      ? [inPerson]
      : opts?.only === "remote"
        ? [remote]
        : [inPerson, remote];

  return [...tiers, closing].join("\n\n");
}

/**
 * Unsuccessful-visit rule copy: full rate only when fixed, discounted labour otherwise, plus a
 * free grace period on the return visit (sentence dropped when 0). Which returns qualify is the
 * operator's call at invoicing, since no booking field records it.
 * @param factor - Unsuccessful-visit charge fraction (defaults to the constant).
 * @param freeMins - Minutes covered free at the start of a return visit (defaults to the constant).
 * @returns Multi-paragraph copy describing the unsuccessful-visit rule.
 */
export function unsuccessfulWorkCopy(
  factor: number = UNSUCCESSFUL_WORK_FACTOR,
  freeMins: number = NO_FIX_FREE_MINS,
): string {
  const chargePhrase =
    factor <= 0
      ? "**No charge**"
      : factor === 0.5
        ? "**Half price**"
        : `**${Math.round(factor * 100)}% of the agreed rate**`;
  const paragraphs = [
    "A visit bills at the agreed rate when the problem is **fixed** - the issue described no longer reproduces by the end of the visit. A partial fix counts as a fix.",
    `${chargePhrase} applies to the labour whenever I can't put the problem right - even when I leave you with a clear diagnosis of what's wrong and what to do next (for example, 'the drive is failing - here is the replacement to order'). Travel and any parts are charged as normal.`,
  ];
  if (freeMins > 0) {
    paragraphs.push(
      `If I leave without fixing the problem, the first **${minutes(freeMins)}** of the return visit are free, whether I'm back at your place or picking it up remotely. That's different from simply running out of time: if the job was going fine and just needed longer, the next visit carries on at the normal rate.`,
    );
  }
  return paragraphs.join("\n\n");
}

/**
 * Workmanship-guarantee text (pricing accordion + FAQ): fallout from a prior visit's changes is
 * fixed free inside the window. Callers hide it when the window is 0.
 * @param windowDays - Days after a visit the guarantee covers (defaults to the constant).
 * @returns Copy describing the workmanship guarantee.
 */
export function workmanshipCopy(windowDays: number = WORKMANSHIP_WINDOW_DAYS): string {
  return (
    `If something I changed on a previous visit causes a new problem within ` +
    `**${days(windowDays)}**, I put it right at **no charge** - labour and travel. ` +
    `That is how I stand behind my work.\n\n` +
    `This covers fallout from my own work. A separate new issue, or a fault ` +
    `outside what I touched, is billed as its own job at the agreed rate.`
  );
}

/**
 * Parts-billing text (pricing accordion + FAQ). No settings input - the
 * at-cost promise has no figure to track.
 * @returns Copy describing how parts and hardware are billed.
 */
export function partsCopy(): string {
  return (
    `Parts and hardware are billed **at cost** - what the supplier charged, ` +
    `receipt included, **no markup** and no commission. You approve the price ` +
    `before I buy anything on your behalf.`
  );
}

/**
 * Travel-policy text, quoting the live travel rate.
 * @param travelRatePerHour - Current travel rate from the pricing settings.
 * @param minTravelCharge - Live minimum travel charge (defaults to the constant).
 * @returns Copy describing the travel charge model.
 */
export function travelCopy(
  travelRatePerHour: number,
  minTravelCharge: number = MIN_TRAVEL_CHARGE,
): string {
  return (
    // Formatted: a promo can halve these into cents, and raw maths prints "$7.5".
    `Travel is **one round trip** billed at **${formatMoneyCompact(travelRatePerHour)}/hr** - a separate, ` +
    `lower rate than labour, with the total **rounded to the nearest $5**. ` +
    `**Minimum ${formatMoneyCompact(minTravelCharge)}** when there is any travel at all. ` +
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
    `**${minBillableMins} minutes minimum** per job, then ` +
    `**${billingIncrementMins}-minute increments** after that. ` +
    `Quick calls and emails stay **free** - a "remote session" is when I log in ` +
    `and start working on your machine.`
  );
}

/**
 * Every day billed at holiday rates, as customer copy names them. Christmas Eve and New Year's
 * Eve aren't public holidays, so copy says "holiday rates" rather than calling them one.
 */
const HOLIDAY_DAYS = `NZ public holidays (${HOME_REGION} Anniversary Day included), Christmas Eve and New Year's Eve`;

/**
 * A labour uplift as a percent, to two decimals so 12.5% never shows as 13%.
 * @param uplift - Uplift as a fraction (0.125 = 12.5%).
 * @returns The percent, e.g. 12.5.
 */
export function upliftPercent(uplift: number): number {
  return Math.round(uplift * 10000) / 100;
}

/**
 * The labour rise a surcharge adds, worked out on the full rate: a promo never discounts it,
 * so a dollar figure stays right under a promo where a percent of the promo rate wouldn't.
 * @param fullRate - Full hourly rate before any promo.
 * @param uplift - Uplift as a fraction.
 * @returns The rise, e.g. "$10/hr".
 */
function risePerHour(fullRate: number, uplift: number): string {
  return `${formatMoneyCompact(roundCents(fullRate * uplift))}/hr`;
}

/**
 * Public-holiday surcharge text, naming every day billed at holiday rates.
 * @param uplift - Surcharge multiplier (defaults to the module constant).
 * @param fullRate - Full on-site hourly rate, to add the rise in dollars; omitted gives the percent only.
 * @returns Copy describing the holiday surcharge.
 */
export function publicHolidayCopy(
  uplift: number = PUBLIC_HOLIDAY_UPLIFT,
  fullRate?: number,
): string {
  const dollars =
    fullRate === undefined ? "" : ` (**${risePerHour(fullRate, uplift)}** for an on-site visit)`;
  return (
    `Available on ${HOLIDAY_DAYS}. When a public holiday falls on a weekend, holiday rates ` +
    `apply on the weekday it's observed instead (ANZAC Day on a Saturday means the Monday). ` +
    `Holiday rates add **${upliftPercent(uplift)}% of the full hourly rate** to labour${dollars}. ` +
    `**Travel and parts are unchanged.**`
  );
}

/**
 * Short wording for the labour share an unsuccessful visit still charges, for the
 * calculator's "Didn't finish" chip and Quick price's "Couldn't fix it" box.
 * @param factor - Charged fraction of the labour (0.5 = half).
 * @returns "half-price labour", "no labour charge", or e.g. "labour at 40%".
 */
export function unsuccessfulShareLabel(factor: number): string {
  if (factor <= 0) return "no labour charge";
  if (factor === 0.5) return "half-price labour";
  return `labour at ${Math.round(factor * 100)}%`;
}

/**
 * Weekend surcharge text, shown with the public-holiday copy.
 * @param uplift - Surcharge multiplier (defaults to the module constant).
 * @param fullRate - Full on-site hourly rate, to add the rise in dollars; omitted gives the percent only.
 * @param holidayUplift - Public-holiday uplift; at 0 Christmas Eve or New Year's Eve on a
 * weekend bills normal rates.
 * @returns Copy describing the weekend surcharge.
 */
export function weekendCopy(
  uplift: number = WEEKEND_UPLIFT,
  fullRate?: number,
  holidayUplift: number = PUBLIC_HOLIDAY_UPLIFT,
): string {
  const dollars =
    fullRate === undefined ? "" : ` (**${risePerHour(fullRate, uplift)}** for an on-site visit)`;
  // A weekend public holiday is observed on a weekday, so the day itself is a plain weekend.
  // The eves aren't moved, and win over a weekend even at 0%, leaving that day at normal rates.
  const onHoliday =
    holidayUplift > 0
      ? "A public holiday that falls on a weekend is charged weekend rates on the day, and holiday rates on the weekday it's observed. Christmas Eve and New Year's Eve take holiday rates even at a weekend - the two never add together."
      : "A public holiday that falls on a weekend is charged weekend rates. Christmas Eve and New Year's Eve are charged at normal rates, even at a weekend.";
  return (
    `Saturday and Sunday appointments add **${upliftPercent(uplift)}% of the full hourly rate** ` +
    `to labour${dollars}. ${onHoliday} **Travel and parts are unchanged.**`
  );
}

/**
 * One-line caveat for copy that quotes a weekday rate: what weekends and holidays add.
 * @param uplifts - Live surcharge fractions from the pricing settings.
 * @param uplifts.publicHolidayUplift - Public-holiday labour uplift (0 = off).
 * @param uplifts.weekendUplift - Weekend labour uplift (0 = off).
 * @param fullRate - Full hourly rate being quoted, to state the rise in dollars; omitted states percents.
 * @returns The sentence, or null when neither surcharge is on.
 */
export function surchargeCaveat(
  uplifts: { publicHolidayUplift: number; weekendUplift: number },
  fullRate?: number,
): string | null {
  /**
   * States one surcharge in dollars at the quoted rate, else as a percent.
   * @param uplift - Labour uplift as a fraction.
   * @returns The rise, e.g. "$10/hr" or "10%".
   */
  const rise = (uplift: number): string =>
    fullRate === undefined ? `${upliftPercent(uplift)}%` : risePerHour(fullRate, uplift);
  const { weekendUplift, publicHolidayUplift } = uplifts;
  if (weekendUplift > 0 && publicHolidayUplift > 0) {
    return (
      `Weekends add ${rise(weekendUplift)} to labour, and public holidays, Christmas Eve and ` +
      `New Year's Eve add ${rise(publicHolidayUplift)}.`
    );
  }
  if (weekendUplift > 0) return `Weekends add ${rise(weekendUplift)} to labour.`;
  if (publicHolidayUplift > 0) {
    return `Public holidays, Christmas Eve and New Year's Eve add ${rise(publicHolidayUplift)} to labour.`;
  }
  return null;
}

/** A labour surcharge: a public holiday, a weekend, or after hours ticked on a weekday. */
export interface DateSurcharge {
  /** Why it applies, for the calculator strip: the holiday's name, "Weekend" or "After hours". */
  reason: string;
  /** Invoice-line wording without the percent, e.g. "Weekend surcharge". */
  label: string;
  /** Labour uplift as a fraction (0.1 = +10%). */
  uplift: number;
}

/**
 * The labour surcharge for a job's date. A public holiday wins over a weekend (never stacked),
 * even when set to 0%.
 * @param holidayName - The NZ public holiday on the job date, or null.
 * @param weekday - NZ weekday of the job, 0 = Sunday through 6 = Saturday.
 * @param uplifts - Live surcharge fractions from the pricing settings.
 * @param uplifts.publicHolidayUplift - Public-holiday labour uplift (0 = off).
 * @param uplifts.weekendUplift - Weekend labour uplift (0 = off).
 * @returns The surcharge to apply, or null when none does.
 */
export function dateSurcharge(
  holidayName: string | null,
  weekday: number,
  uplifts: { publicHolidayUplift: number; weekendUplift: number },
): DateSurcharge | null {
  if (holidayName !== null) {
    return uplifts.publicHolidayUplift > 0
      ? {
          reason: holidayName,
          label: "Public holiday surcharge",
          uplift: uplifts.publicHolidayUplift,
        }
      : null;
  }
  if ((weekday === 0 || weekday === 6) && uplifts.weekendUplift > 0) {
    return weekendSurcharge(uplifts.weekendUplift);
  }
  return null;
}

/**
 * The weekend surcharge at a given uplift.
 * @param uplift - Weekend labour uplift as a fraction.
 * @returns The surcharge, or null when weekend rates are off (0).
 */
function weekendSurcharge(uplift: number): DateSurcharge | null {
  return uplift > 0 ? { reason: "Weekend", label: "Weekend surcharge", uplift } : null;
}

/**
 * The surcharge an operator's tick switches: the date's own, else the weekend uplift billed
 * as after hours, so an evening call on a weekday reads right on the invoice.
 * @param fromDate - The date's surcharge from {@link dateSurcharge}, or null.
 * @param weekendUplift - Weekend labour uplift (0 = off), which after hours shares.
 * @returns The surcharge the tick controls, or null when there's nothing to switch on.
 */
export function surchargeOption(
  fromDate: DateSurcharge | null,
  weekendUplift: number,
): DateSurcharge | null {
  if (fromDate) return fromDate;
  return weekendUplift > 0
    ? { reason: "After hours", label: "After-hours surcharge", uplift: weekendUplift }
    : null;
}

/**
 * The surcharge a job bills once the operator's tick is applied.
 * @param fromDate - The date's surcharge from {@link dateSurcharge}, or null.
 * @param on - The tick: true bills {@link surchargeOption}, false bills none, null follows the date.
 * @param weekendUplift - Weekend labour uplift (0 = off).
 * @returns The surcharge to bill, or null.
 */
export function chosenSurcharge(
  fromDate: DateSurcharge | null,
  on: boolean | null,
  weekendUplift: number,
): DateSurcharge | null {
  if (on === null) return fromDate;
  return on ? surchargeOption(fromDate, weekendUplift) : null;
}

/** A booking day's surcharge with its rise in $/hr at the full rates, for the day-picker note. */
export interface PricedDateSurcharge extends DateSurcharge {
  /** Labour rise in $/hr at the full on-site rate. */
  perHour: number;
  /** Labour rise in $/hr at the full remote rate. */
  perHourRemote: number;
}

/**
 * Customer-facing note shown when a surcharged booking day is picked. Holidays read "holiday
 * rates apply", since Christmas Eve and New Year's Eve bill them without being public holidays.
 * @param surcharge - The day's surcharge; priced ones (from withDateSurcharges) state dollars.
 * @returns One plain sentence naming the reason, the rise and what it leaves alone.
 */
export function dateSurchargeNote(surcharge: DateSurcharge | PricedDateSurcharge): string {
  let rise: string;
  if ("perHour" in surcharge) {
    const remote =
      surcharge.perHourRemote !== surcharge.perHour
        ? ` (${formatMoneyCompact(surcharge.perHourRemote)}/hr for remote support)`
        : "";
    rise = `labour costs ${formatMoneyCompact(surcharge.perHour)}/hr more${remote}`;
  } else {
    rise = `labour costs an extra ${upliftPercent(surcharge.uplift)}% of the full hourly rate`;
  }
  const lead =
    surcharge.reason === "Weekend"
      ? `Weekend rates apply on Saturdays and Sundays: ${rise}.`
      : `${surcharge.reason}: holiday rates apply, so ${rise}.`;
  return `${lead} Travel and parts cost the same.`;
}

/**
 * Line under a booking estimate whose labour range includes a date surcharge.
 * @param surcharge - The picked day's surcharge from {@link dateSurcharge}.
 * @returns One short sentence naming the surcharge and its percent.
 */
export function quoteSurchargeNote(surcharge: DateSurcharge): string {
  const kind = surcharge.reason === "Weekend" ? "weekend" : "holiday";
  return `Includes the ${upliftPercent(surcharge.uplift)}% ${kind} surcharge on labour.`;
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
 * Bundle of every policy value, resolved live by `getPolicy()`. A type, not an eager const:
 * {@link MIN_TRAVEL_CHARGE} comes from business.ts, which imports back from here (circular TDZ).
 */
export interface Policy {
  GST_REGISTERED: boolean;
  GST_RATE: number;
  MIN_TRAVEL_CHARGE: number;
  TRAVEL_RATE_PER_HOUR: number;
  MIN_BILLABLE_MINS: number;
  BILLING_INCREMENT_MINS: number;
  SHORT_TASK_MINS: number;
  MIN_TASK_MINS: number;
  MAX_JOB_MINS: number;
  PUBLIC_HOLIDAY_UPLIFT: number;
  WEEKEND_UPLIFT: number;
  UNSUCCESSFUL_WORK_FACTOR: number;
  NO_FIX_FREE_MINS: number;
  WORKMANSHIP_WINDOW_DAYS: number;
  MERGE_SUGGEST_GAP_MINS: number;
  CANCELLATION: CancellationPolicy;
}
