// src/features/business/lib/business.ts
// Core business calculation helpers - billable-minute and hourly-rate maths, travel
// totals, job-to-line-item building, promo discounts and job totals. Also the stable
// public entry for the display helpers (business-format.ts), task-timing maths
// (task-timing.ts) and invoice/GST/ledger helpers (invoice-maths.ts), re-exported below
// so importers keep one path. Shared by the calculator, invoice, ledger, and admin
// booking views.

import { calcGstFromInclusive, calcInvoiceTotals } from "@/features/business/lib/invoice-maths";
import {
  BILLING_INCREMENT_MINS,
  GST_RATE,
  GST_REGISTERED,
  MIN_BILLABLE_MINS,
} from "@/features/business/lib/pricing-policy";
import { promoForSpend, type PromoTierValues } from "@/features/business/lib/promo-tiers";
import {
  collapseToWindow,
  enforceMinBillable,
  explicitRoundingAllowanceMins,
  isHourlyTask,
  TASK_TIMING_FALLBACK,
  type TaskTimingConfig,
} from "@/features/business/lib/task-timing";
import type {
  JobCalculation,
  LineItem,
  RateConfig,
  TravelEntry,
} from "@/features/business/types/business";
import { timeParts } from "@/shared/lib/timezone-utils";

export {
  composeDescription,
  formatBilledTime,
  formatMins,
  formatMoneyCompact,
  formatNZD,
  lineItemQtyLabel,
  minsToHoursLabel,
  promoLineLabel,
  todayISO,
} from "@/features/business/lib/business-format";
export {
  advanceNextDue,
  balanceDue,
  buildIncomeDescription,
  calcGstFromInclusive,
  calcInvoiceTotals,
  isValidLineItem,
  nextInvoiceNumber,
  splitGstInclusive,
} from "@/features/business/lib/invoice-maths";
export {
  collapseToWindow,
  enforceMinBillable,
  explicitRoundingAllowanceMins,
  hourlyTaskMinutes,
  TASK_TIMING_FALLBACK,
  taskMinutes,
  type TaskTimingConfig,
} from "@/features/business/lib/task-timing";

/**
 * Minimum travel cost (NZD) below which a calculated travel charge is
 * skipped rather than added to the invoice - a sub-$10 line item looks petty.
 * The travelInfo is still surfaced in the UI so the operator can add it manually.
 */
export const MIN_TRAVEL_CHARGE = 10;

/**
 * Rounds a duration to the nearest {@link BILLING_INCREMENT_MINS} slot. Symmetric
 * rounding so customers are never bumped a full slot for a single minute of
 * overage; the operator gives back as often as they collect.
 * @param mins - Actual duration in minutes
 * @param incrementMins - Billing increment (live pricing setting); defaults to the code const, and a non-positive value falls back to it (guards a divide-by-zero).
 * @returns Billable duration rounded to the nearest billing increment
 */
export function billableMins(mins: number, incrementMins: number = BILLING_INCREMENT_MINS): number {
  const inc = incrementMins > 0 ? incrementMins : BILLING_INCREMENT_MINS;
  if (mins <= 0) return 0;
  return Math.round(mins / inc) * inc;
}

/**
 * Minutes between two HH:MM strings, rolling past midnight. Empty/invalid
 * inputs collapse to 0 (matches the calculator's pre-existing behaviour). An
 * End earlier than Start is treated as the next day (e.g. 23:40 > 00:10 is 30
 * min), so overnight slots read straight off the clock without a duration
 * override. Equal times stay 0 so a half-typed session doesn't sneak a full
 * day into the aggregate.
 * @param start - HH:MM start.
 * @param end - HH:MM end.
 * @returns Non-negative minute diff, or 0 when inputs are unusable.
 */
export function timeDiffMins(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = timeParts(start);
  const [eh, em] = timeParts(end);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 0;
  const diff = eh * 60 + em - (sh * 60 + sm);
  if (diff > 0) return diff;
  if (diff < 0) return diff + 24 * 60;
  return 0;
}

/**
 * Sums every travel-entry cost into the single "Travel" total used by the
 * invoice line item and the job totals breakdown.
 * @param entries - Travel entries from the calculator (may be empty).
 * @returns Total travel charge in NZD, rounded to 2dp.
 */
export function travelEntriesTotal(entries: TravelEntry[]): number {
  return Math.round(entries.reduce((s, e) => s + (e.cost || 0), 0) * 100) / 100;
}

/** A job's travel split the way the invoice bills it. */
export interface TravelSplit {
  /** The trip to the client plus disbursements (parking, tolls), after the minimum charge. */
  tripTotal: number;
  /** Store runs with a cost, each billed on its own line. */
  storeRuns: TravelEntry[];
  /** tripTotal plus every store run. */
  total: number;
}

/**
 * Splits a job's travel into the trip to the client and any store runs. The minimum
 * travel charge lifts only the trip, and only when it has a looked-up drive, so
 * manual-only entries like parking never trigger it. Store runs bill as priced, with no
 * minimum, so a $0 run adds nothing.
 * @param entries - Travel entries from the calculator (may be empty).
 * @param minTravelCharge - Live minimum travel charge.
 * @returns The trip total, the store runs, and the combined total.
 */
export function splitTravel(entries: TravelEntry[], minTravelCharge: number): TravelSplit {
  const storeRuns = entries.filter((e) => e.kind === "storeRun" && e.cost > 0);
  const trip = entries.filter((e) => e.kind !== "storeRun");
  const rawTrip = travelEntriesTotal(trip);
  const hasAutoEntry = trip.some((e) => e.isAuto && e.cost > 0);
  const tripTotal =
    hasAutoEntry && rawTrip > 0 && rawTrip < minTravelCharge ? minTravelCharge : rawTrip;
  const total = Math.round((tripTotal + travelEntriesTotal(storeRuns)) * 100) / 100;
  return { tripTotal, storeRuns, total };
}

/**
 * Delivery-channel modifier labels, lower-cased. A task has exactly one channel
 * - the work happened at the client's place, at the operator's, over a screen
 * share, or on a call - so these never stack, and picking one replaces any
 * other. Matched on the DEFAULT label names, so a renamed channel row drops out
 * of the group and stacks again.
 */
export const CHANNEL_MODIFIER_LABELS = new Set(["at home", "remote", "phone"]);

/**
 * Tests whether a rate row is a delivery channel rather than a freely stacking
 * modifier. Shared by the calculator's chips and the parse-job route so the UI
 * and the AI output enforce the same exclusivity.
 * @param rate - Rate row to test, or anything carrying its label.
 * @param rate.label - Label to match, compared trimmed and case-insensitively.
 * @returns True for a delivery channel (At home / Remote / Phone).
 */
export function isChannelModifier(rate: { label: string }): boolean {
  return CHANNEL_MODIFIER_LABELS.has(rate.label.trim().toLowerCase());
}

/**
 * Computes the effective hourly rate for a task by composing the base rate
 * with its modifiers. Sums `hourlyDelta` first, then multiplies by any
 * `percentDelta` (e.g. Public Holiday +25%) so the uplift acts on the
 * post-modifier base. E.g. Standard ($65) + At home (-$10) = $55.
 * @param rates - All rate configurations (used to look up by ID).
 * @param baseRateId - Base rate ID (must point to a rate with ratePerHour set).
 * @param modifierIds - Modifier rate IDs.
 * @returns Effective $/hr, or 0 when the base rate isn't found / lacks ratePerHour.
 */
export function effectiveHourlyRate(
  rates: RateConfig[],
  baseRateId: string | null | undefined,
  modifierIds: string[] | null | undefined,
): number {
  if (!baseRateId) return 0;
  const base = rates.find((r) => r.id === baseRateId);
  if (!base || base.ratePerHour === null) return 0;
  const ids = modifierIds ?? [];
  const mods = ids.map((id) => rates.find((r) => r.id === id)).filter((m): m is RateConfig => !!m);
  const sumDelta = mods.reduce((s, m) => s + (m.hourlyDelta ?? 0), 0);
  const percentFactor = mods.reduce((f, m) => f * (1 + (m.percentDelta ?? 0)), 1);
  return Math.round((base.ratePerHour + sumDelta) * percentFactor * 100) / 100;
}

/**
 * Converts a job calculation into a flat array of invoice line items.
 * Emits one row per task, one row per part, and a single Travel row summed
 * from `travelEntries`. Mirrors {@link calcJobTotal}'s {@link MIN_TRAVEL_CHARGE}
 * and {@link enforceMinBillable} floors so the issued invoice matches the
 * operator's on-screen total.
 * @param job - Job calculation with tasks, parts, and travel.
 * @param holidayUplift - Public-holiday labour uplift fraction (0 = none); adds a surcharge line.
 * @param minTravelCharge - Minimum auto-travel charge (live pricing setting); defaults to the code const.
 * @param minBillableMins - Minimum billable labour minutes (live pricing setting); defaults to the code const.
 * @returns Array of line items ready for an invoice.
 */
export function jobToLineItems(
  job: JobCalculation,
  holidayUplift: number = 0,
  minTravelCharge: number = MIN_TRAVEL_CHARGE,
  minBillableMins: number = MIN_BILLABLE_MINS,
): LineItem[] {
  const items: LineItem[] = [];
  // Running total of hourly-task labour so the public-holiday surcharge line
  // can uplift exactly that, never travel or parts.
  let labourTotal = 0;

  for (const task of enforceMinBillable(job.tasks, minBillableMins)) {
    const lineTotal = Math.round(task.qty * task.unitPrice * 100) / 100;
    items.push({
      description: task.description,
      qty: task.qty,
      unitPrice: task.unitPrice,
      lineTotal,
      // Carry the billed minutes onto hourly rows so the invoice renders h:mm
      // and the column sums to the session; flat rows keep a plain count.
      ...(task.minutes != null && isHourlyTask(task) && { minutes: task.minutes }),
    });
    if (isHourlyTask(task)) labourTotal += lineTotal;
  }

  if (holidayUplift > 0 && labourTotal > 0) {
    const surcharge = Math.round(labourTotal * holidayUplift * 100) / 100;
    if (surcharge > 0) {
      items.push({
        description: `Public holiday surcharge (+${Math.round(holidayUplift * 100)}%)`,
        qty: 1,
        unitPrice: surcharge,
        lineTotal: surcharge,
      });
    }
  }

  for (const part of job.parts) {
    items.push({
      description: part.description,
      qty: 1,
      unitPrice: part.cost,
      lineTotal: part.cost,
    });
  }

  const { tripTotal, storeRuns } = splitTravel(job.travelEntries, minTravelCharge);
  if (tripTotal > 0) {
    // Drive minutes across auto entries (back leg falls back to outbound on
    // legacy drafts) so the line reads "Round-trip travel (46 min drive)".
    const driveMins = job.travelEntries.reduce((sum, e) => {
      if (!e.isAuto || !e.durationMinsOneWay) return sum;
      return sum + e.durationMinsOneWay + (e.durationMinsBack ?? e.durationMinsOneWay);
    }, 0);
    items.push({
      description:
        driveMins > 0 ? `Round-trip travel (${driveMins} min drive)` : "Round-trip travel",
      qty: 1,
      unitPrice: tripTotal,
      lineTotal: tripTotal,
    });
  }
  for (const run of storeRuns) {
    const runMins = (run.durationMinsOneWay ?? 0) + (run.durationMinsBack ?? 0);
    items.push({
      description: runMins > 0 ? `Store run (${runMins} min drive)` : "Store run",
      qty: 1,
      unitPrice: run.cost,
      lineTotal: run.cost,
    });
  }

  return items;
}

/** Active-promo shape consumed by {@link calcJobTotal}. Kept loose so business.ts doesn't depend on the wider promos module. */
export interface JobPromo {
  /** Which value below applies. Null on rows predating the column - treated as a rate promo. */
  discountType?: "flat_hourly" | "percent" | "fixed_amount" | "free_travel" | null;
  flatHourlyRate: number | null;
  percentDiscount: number | null;
  fixedAmount?: number | null;
  travelPercent?: number | null;
  /** Floor for the pre-discount subtotal, or null/absent for none. */
  minSpend?: number | null;
  /** Spend bands; when non-empty they supply the discount instead of the values above. */
  tiers?: PromoTierValues[];
}

/** Live pricing values threaded into {@link calcJobTotal}; defaults are the code consts. */
export interface JobPricing {
  gstRegistered: boolean;
  minTravelCharge: number;
  /** Minimum billable labour minutes; the whole-job floor applied by {@link enforceMinBillable}. */
  minBillableMins: number;
  /** Public-holiday labour uplift as a fraction (e.g. 0.25); 0/undefined when the job date isn't a holiday. */
  holidayUplift?: number;
  /** Fraction charged for an unsuccessful visit (e.g. 0.5 = half); defaults to 0.5. */
  unsuccessfulFactor?: number;
  /**
   * RateConfig id of the "Business" modifier. Labour carrying it is excluded
   * from promo discounts: promos are a home-rate offer, and without this a
   * business job priced during one is silently under-charged.
   */
  businessModifierId?: string | null;
  /**
   * The undiscounted Standard $/hr. A flat promo takes (Standard - flat) off
   * every home-rate hour, so a remote or phone line moves down with it; without
   * this each line is instead capped at the flat rate.
   */
  standardRate?: number | null;
  /**
   * Live rate list. Lets a flat promo floor each line at the promo price for its
   * rate tags, so a line priced below the live rate (an old price, a stale
   * draft) is not cut by the full (Standard - flat) and billed under the promo.
   */
  rates?: RateConfig[];
  /**
   * Live task-timing settings for {@link collapseToWindow} and
   * {@link explicitRoundingAllowanceMins}. Not a {@link calcJobTotal} input -
   * it rides along so the calculator's apportionment reads the same settings
   * bundle as the totals. Falls back to {@link TASK_TIMING_FALLBACK}.
   */
  taskTiming?: TaskTimingConfig;
}

/**
 * Promo discount on a job's labour only (hourly task lines).
 *
 * Exported for check:promo-pricing - this decides real money on an invoice and
 * the business exclusion below has no other coverage.
 * @param job - Job calculation.
 * @param resolvedPromo - Active promo or null, before spend narrows it.
 * @param travelTotal - The job's travel charge, which a free-travel promo discounts.
 * @param businessModifierId - Modifier marking business labour, which promos skip.
 * @param preDiscountSubtotal - The job's subtotal before any discount, which selects a tier.
 * @param standardRate - Undiscounted Standard $/hr, which a flat promo's per-hour cut is taken from.
 * @param rates - Live rate list, which floors each line at the promo price for its rate tags.
 * @returns Discount in dollars.
 */
export function computeJobPromoDiscount(
  job: JobCalculation,
  resolvedPromo: JobPromo | null,
  travelTotal: number,
  businessModifierId?: string | null,
  preDiscountSubtotal?: number,
  standardRate?: number | null,
  rates?: RateConfig[],
): number {
  return jobPromoBreakdown(
    job,
    resolvedPromo,
    travelTotal,
    businessModifierId,
    preDiscountSubtotal,
    standardRate,
    rates,
  ).total;
}

/**
 * {@link computeJobPromoDiscount}'s total plus each task line's share of it, so
 * {@link calcJobTotal} can take the unsuccessful-work discount off what the line
 * costs after the promo. Shares are unrounded, in `job.tasks` order, and 0 for
 * lines the promo skips (all 0 for a travel promo). A fixed amount is spread
 * across the discounted lines in proportion to their totals.
 * @param job - Job calculation.
 * @param resolvedPromo - Active promo or null, before spend narrows it.
 * @param travelTotal - The job's travel charge, which a free-travel promo discounts.
 * @param businessModifierId - Modifier marking business labour, which promos skip.
 * @param preDiscountSubtotal - The job's subtotal before any discount, which selects a tier.
 * @param standardRate - Undiscounted Standard $/hr, which a flat promo's per-hour cut is taken from.
 * @param rates - Live rate list, which floors each line at the promo price for its rate tags.
 * @returns The rounded discount and each task line's unrounded share of it.
 */
function jobPromoBreakdown(
  job: JobCalculation,
  resolvedPromo: JobPromo | null,
  travelTotal: number,
  businessModifierId?: string | null,
  preDiscountSubtotal?: number,
  standardRate?: number | null,
  rates?: RateConfig[],
): { total: number; byTask: number[] } {
  const none = { total: 0, byTask: job.tasks.map(() => 0) };
  // Narrowed to the band this job actually earns, through the same function the
  // public estimate uses. Judged on the pre-discount subtotal the caller has
  // already computed; without one there is nothing to judge, so an untiered
  // promo passes through and a tiered one cannot apply.
  const promo = promoForSpend(resolvedPromo, preDiscountSubtotal ?? 0);
  if (!promo) return none;

  /**
   * Whether a task carries the Business modifier.
   * @param t - The task line to classify.
   * @returns True when the line is business labour.
   */
  const isBusinessTask = (t: (typeof job.tasks)[number]): boolean =>
    !!businessModifierId && (t.modifierIds ?? []).includes(businessModifierId);

  // Travel is its own flat line rather than an hourly task, so a travel promo
  // is the one type that does not touch the labour subtotal at all.
  if (promo.discountType === "free_travel" && promo.travelPercent != null) {
    // A visit that did any business work is a business visit, so its drive is
    // not discounted either. Erring toward charging in full: promos are a home
    // offer, and the alternative silently under-bills a business customer.
    if (job.tasks.some(isBusinessTask)) return none;
    const charged = Math.min(1, Math.max(0, promo.travelPercent));
    return { ...none, total: Math.round(travelTotal * (1 - charged) * 100) / 100 };
  }

  /**
   * Whether the promo discounts a task. A task is hourly if either: it has a
   * baseRateId set (new rate model), OR no flat rateConfigId. The double check
   * survives stale AI output that forgets to clear rateConfigId. Business labour
   * is out of scope for a promo, checked per task rather than per job so a mixed
   * job discounts only its home-rate lines.
   * @param t - The task line to classify.
   * @returns True when the promo applies to the line.
   */
  const isDiscounted = (t: (typeof job.tasks)[number]): boolean =>
    (t.baseRateId != null || t.rateConfigId == null) && !isBusinessTask(t);
  /**
   * A task's line total, rounded as jobToLineItems and calcJobTotal round it. A raw
   * sum discounts a base the invoice never prints, landing the promo a cent off.
   * @param t - The task line.
   * @returns The line total in dollars.
   */
  const lineOf = (t: (typeof job.tasks)[number]): number =>
    Math.round(t.qty * t.unitPrice * 100) / 100;
  /**
   * Each task's share from a per-line rule, 0 for lines the promo skips.
   * @param rule - The discount on one discounted line, given the task and its line total.
   * @returns Shares in `job.tasks` order.
   */
  const shares = (rule: (t: (typeof job.tasks)[number], line: number) => number): number[] =>
    job.tasks.map((t) => (isDiscounted(t) ? rule(t, lineOf(t)) : 0));
  const labourSubtotal = job.tasks.filter(isDiscounted).reduce((s, t) => s + lineOf(t), 0);
  if (labourSubtotal <= 0) return none;

  if (promo.flatHourlyRate !== null) {
    const flat = promo.flatHourlyRate;
    // With the Standard rate known, the promo is a per-hour cut of
    // (Standard - flat) off every home-rate hour, so each modified line keeps
    // its usual gap from Standard, matching applyPromoToHourlyRate. Each
    // line's cut is capped at the line, so no line goes negative.
    const cut = standardRate != null ? Math.max(0, standardRate - flat) : null;
    // Per line, never netted across the job. Without the Standard rate, a line
    // already under the flat rate stays as it is; netting its shortfall against
    // a line above would cancel the saving the pricing page promises there.
    const byTask = shares((t, line) => {
      if (cut == null) return Math.max(0, line - t.qty * flat);
      // Floor the hour at the promo price for the line's tags (live rate less
      // the cut). A line typed or saved under the live rate only comes down to
      // that floor: at an old $75 Standard the full $35 cut would bill $40/hr,
      // under the $65 the promo promises.
      const live =
        rates && t.baseRateId ? effectiveHourlyRate(rates, t.baseRateId, t.modifierIds) : 0;
      const hourCut =
        live > 0 ? Math.min(cut, Math.max(0, t.unitPrice - Math.max(0, live - cut))) : cut;
      return Math.min(line, t.qty * hourCut);
    });
    return { total: Math.round(byTask.reduce((s, d) => s + d, 0) * 100) / 100, byTask };
  }
  if (promo.percentDiscount !== null) {
    const pct = Math.max(0, Math.min(1, promo.percentDiscount));
    return {
      total: Math.round(labourSubtotal * pct * 100) / 100,
      byTask: shares((_, line) => line * pct),
    };
  }
  if (promo.discountType === "fixed_amount" && promo.fixedAmount != null) {
    // Capped at the labour subtotal, matching applyPromoToQuote: travel is the
    // operator's driving time rather than margin, so a discount larger than the
    // labour is capped instead of eating into it.
    const amount = Math.min(Math.max(0, promo.fixedAmount), labourSubtotal);
    return {
      total: Math.round(amount * 100) / 100,
      byTask: shares((_, line) => (amount * line) / labourSubtotal),
    };
  }
  return none;
}

/**
 * Cost breakdown for a job. Promo discount applies to labour only; travel +
 * parts stay at full price. The whole-job unsuccessful flag discounts the entire
 * labour portion (hourly task lines) by the unsuccessful-work factor; otherwise
 * per-task `unsuccessful` flags discount just those lines. Both fold into the
 * single `unsuccessfulDiscount`.
 * GST mode is driven by {@link GST_REGISTERED} (see {@link calcInvoiceTotals}).
 * Travel floor ({@link MIN_TRAVEL_CHARGE}) only applies when an auto entry
 * contributed - manual-only travel passes through unchanged. The whole-job
 * minimum-billable floor ({@link enforceMinBillable}) is applied up front so
 * short jobs bill at least the configured minimum.
 * @param jobIn - Job calculation with tasks, parts, and travel.
 * @param promo - Optional active promo to apply.
 * @param pricing - Live pricing (GST, min travel, min billable, holiday uplift); defaults to the code consts.
 * @returns Cost breakdown with promo + unsuccessful discounts split out.
 */
export function calcJobTotal(
  jobIn: JobCalculation,
  promo: JobPromo | null = null,
  // Default built lazily (call-time, not module-eval) so reading the consts
  // here can't trip the circular-import TDZ with the pricing-policy module.
  pricing: JobPricing = {
    gstRegistered: GST_REGISTERED,
    minTravelCharge: MIN_TRAVEL_CHARGE,
    minBillableMins: MIN_BILLABLE_MINS,
  },
): {
  tasksTotal: number;
  partsTotal: number;
  travelTotal: number;
  holidaySurcharge: number;
  subtotal: number;
  promoDiscount: number;
  unsuccessfulDiscount: number;
  gstAmount: number;
  total: number;
} {
  // Apply the whole-job minimum-billable floor once, up front, so every
  // labour-derived figure below (tasks total, holiday uplift, promo and
  // unsuccessful discounts) agrees with the floored invoice lines.
  const job = { ...jobIn, tasks: enforceMinBillable(jobIn.tasks, pricing.minBillableMins) };
  // Round each task line before summing, exactly as jobToLineItems does: this preview and
  // the saved invoice must land on the same cent, and summing unrounded quoted $75.83 for
  // a job whose invoice then read $75.84.
  const tasksTotal = job.tasks.reduce((s, t) => s + Math.round(t.qty * t.unitPrice * 100) / 100, 0);
  const partsTotal = job.parts.reduce((s, p) => s + p.cost, 0);
  const { tripTotal, total: travelTotal } = splitTravel(job.travelEntries, pricing.minTravelCharge);
  // Public-holiday surcharge uplifts labour only (hourly task lines), never
  // travel or parts. 0 when the job date isn't a holiday.
  const holidayUplift = pricing.holidayUplift ?? 0;
  // Per-line rounding again: jobToLineItems accumulates its labour running
  // total from the ROUNDED lineTotals, so the surcharge must be derived from
  // the same base or the surcharge line itself drifts a cent.
  const hourlyTasksTotal = job.tasks
    .filter(isHourlyTask)
    .reduce((s, t) => s + Math.round(t.qty * t.unitPrice * 100) / 100, 0);
  const holidaySurcharge =
    holidayUplift > 0 ? Math.round(hourlyTasksTotal * holidayUplift * 100) / 100 : 0;
  const subtotal =
    Math.round((tasksTotal + partsTotal + travelTotal + holidaySurcharge) * 100) / 100;
  const { total: promoDiscount, byTask: promoByTask } = jobPromoBreakdown(
    job,
    promo,
    // A free-travel promo covers getting to the client, not a store run.
    tripTotal,
    pricing.businessModifierId,
    // The subtotal above is exactly the pre-discount total a spend threshold and
    // a tier band are judged against.
    subtotal,
    pricing.standardRate,
    pricing.rates,
  );
  // Fraction removed from an unsuccessful line: 1 - the charged share.
  const unsuccessfulCut = 1 - (pricing.unsuccessfulFactor ?? 0.5);
  // "Half price" is half of what the customer was due to pay, so each unsuccessful
  // line is cut after its promo share comes off. Taking both off the full line would
  // stack them: a 35%-off promo plus half price would bill 15% of the labour, not
  // 32.5%. The whole-job flag covers every hourly task and subsumes per-task flags,
  // so a task can't be discounted twice; lines are rounded the same way in both
  // cases, so flagging every task matches the whole-job flag to the cent.
  const unsuccessfulBase = job.tasks.reduce(
    (s, t, i) =>
      isHourlyTask(t) && (job.unsuccessful || t.unsuccessful)
        ? s + Math.round(t.qty * t.unitPrice * 100) / 100 - (promoByTask[i] ?? 0)
        : s,
    0,
  );
  const unsuccessfulDiscount = Math.max(
    0,
    Math.round(unsuccessfulBase * unsuccessfulCut * 100) / 100,
  );
  // GST applies to the discounted amount, per IRD price-reduction treatment. Clamped at 0
  // like calcInvoiceTotals, so stacked promo + unsuccessful discounts can't drive the
  // total negative and disagree with the persisted invoice.
  const taxableAmount = Math.max(
    0,
    Math.round((subtotal - promoDiscount - unsuccessfulDiscount) * 100) / 100,
  );
  const gstAmount = pricing.gstRegistered ? calcGstFromInclusive(taxableAmount, GST_RATE) : 0;
  return {
    tasksTotal,
    partsTotal,
    travelTotal,
    holidaySurcharge,
    subtotal,
    promoDiscount,
    unsuccessfulDiscount,
    gstAmount,
    total: taxableAmount,
  };
}
