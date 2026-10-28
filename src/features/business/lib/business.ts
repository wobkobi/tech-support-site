// src/features/business/lib/business.ts
// Core business maths: billable minutes, hourly rates, travel, line items, promo discounts
// and job totals. Also re-exports the format, task-timing and invoice-maths helpers.

import { formatMoneyCompact, unsuccessfulNote } from "@/features/business/lib/business-format";
import {
  calcGstFromInclusive,
  calcInvoiceTotals,
  splitLineTotals,
  type LineAmountInput,
} from "@/features/business/lib/invoice-maths";
import {
  BILLING_INCREMENT_MINS,
  GST_RATE,
  GST_REGISTERED,
  MIN_BILLABLE_MINS,
} from "@/features/business/lib/pricing-policy";
import { lockedDeltaShift, type LockedDelta } from "@/features/business/lib/promo-locked-rates";
import { promoForSpend, type PromoTierValues } from "@/features/business/lib/promo-tiers";
import {
  collapseToWindow,
  enforceMinBillable,
  explicitRoundingAllowanceMins,
  isHourlyTask,
  TASK_TIMING_FALLBACK,
  taskMinutes,
  type TaskTimingConfig,
} from "@/features/business/lib/task-timing";
import type {
  JobCalculation,
  LineItem,
  PromoRateSummary,
  RateConfig,
  TaskLine,
  TravelEntry,
} from "@/features/business/types/business";
import { roundCents } from "@/shared/lib/money";
import { timeParts } from "@/shared/lib/timezone-utils";

export {
  composeDescription,
  formatBilledTime,
  formatMins,
  formatMoneyCompact,
  formatNZD,
  goldCardLineLabel,
  goldCardOffText,
  lineItemQtyLabel,
  minsToHoursLabel,
  promoLineLabel,
  promoRateNote,
  restatesTaskLine,
  settledCallout,
  settlementRows,
  todayISO,
  UNSUCCESSFUL_LINE_LABEL,
  unsuccessfulNote,
} from "@/features/business/lib/business-format";
export type { SettlementRow } from "@/features/business/lib/business-format";
export {
  advanceNextDue,
  balanceDue,
  buildIncomeDescription,
  calcGstFromInclusive,
  calcInvoiceTotals,
  isValidLineItem,
  nextInvoiceNumber,
  numberSequence,
  splitGstInclusive,
  splitLineTotals,
  withSplitLineTotals,
  type LineAmountInput,
} from "@/features/business/lib/invoice-maths";
export {
  collapseToWindow,
  enforceMinBillable,
  explicitRoundingAllowanceMins,
  hourlyTaskMinutes,
  TASK_TIMING_FALLBACK,
  taskMinutes,
  taskWindowMismatch,
  type TaskTimingConfig,
  type TaskWindowMismatch,
} from "@/features/business/lib/task-timing";

/**
 * Fallback minimum (NZD) for a non-zero auto-calculated trip (see {@link splitTravel});
 * the live value comes from pricing settings.
 */
export const MIN_TRAVEL_CHARGE = 10;

/**
 * Rounds a duration to the nearest {@link BILLING_INCREMENT_MINS} slot, symmetrically so
 * one minute over never bumps a full slot.
 * @param mins - Actual duration in minutes
 * @param incrementMins - Billing increment; a missing or non-positive value uses the code const.
 * @returns Billable duration rounded to the nearest billing increment
 */
export function billableMins(mins: number, incrementMins: number = BILLING_INCREMENT_MINS): number {
  const inc = incrementMins > 0 ? incrementMins : BILLING_INCREMENT_MINS;
  if (mins <= 0) return 0;
  return Math.round(mins / inc) * inc;
}

/**
 * Minutes between two HH:MM strings, rolling past midnight (23:40 > 00:10 is 30 min).
 * Invalid inputs and equal times give 0.
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
 * Sums every travel-entry cost into the single "Travel" total. A negative entry counts as
 * $0, so the calculator's total and the invoice's travel line can't part ways over it.
 * @param entries - Travel entries from the calculator (may be empty).
 * @returns Total travel charge in NZD, rounded to 2dp.
 */
export function travelEntriesTotal(entries: TravelEntry[]): number {
  return roundCents(entries.reduce((s, e) => s + Math.max(0, e.cost || 0), 0));
}

/**
 * Whether a travel entry is the looked-up drive to the client, even after its price is
 * edited (which clears isAuto but keeps the drive time). Entries without one are
 * disbursements like parking.
 * @param entry - Travel entry to classify.
 * @returns True for the client drive; false for store runs and disbursements.
 */
export function isTripDrive(entry: TravelEntry): boolean {
  return entry.kind !== "storeRun" && (entry.isAuto === true || entry.durationMinsOneWay != null);
}

/** A job's travel split the way the invoice bills it. */
export interface TravelSplit {
  /** The trip to the client plus disbursements (parking, tolls), after the minimum charge. */
  tripTotal: number;
  /** The drive part of tripTotal, without disbursements: what free travel waives. */
  driveTotal: number;
  /** Store runs with a cost, each billed on its own line. */
  storeRuns: TravelEntry[];
  /** tripTotal plus every store run. */
  total: number;
}

/**
 * Splits a job's travel into the trip to the client and any store runs. The minimum charge
 * lifts only a trip with a looked-up drive; store runs bill as priced.
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
  const drives = trip.filter(isTripDrive);
  const driveTotal = roundCents(travelEntriesTotal(drives) + (tripTotal - rawTrip));
  const total = roundCents(tripTotal + travelEntriesTotal(storeRuns));
  return { tripTotal, driveTotal, storeRuns, total };
}

/**
 * Delivery-channel modifier labels, lower-cased. A task has exactly one channel, so these
 * never stack. Matched on the default labels, so a renamed row stacks again.
 */
export const CHANNEL_MODIFIER_LABELS = new Set(["at home", "remote"]);

/**
 * Whether a rate row is a delivery channel rather than a freely stacking modifier. Shared
 * by the calculator and the parse-job route.
 * @param rate - Rate row to test, or anything carrying its label.
 * @param rate.label - Label to match, compared trimmed and case-insensitively.
 * @returns True for a delivery channel (At home / Remote).
 */
export function isChannelModifier(rate: { label: string }): boolean {
  return CHANNEL_MODIFIER_LABELS.has(rate.label.trim().toLowerCase());
}

/**
 * Effective hourly rate for a task: sums `hourlyDelta` first, then applies any
 * `percentDelta`. E.g. Standard ($65) + At home (-$10) = $55.
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
  return roundCents((base.ratePerHour + sumDelta) * percentFactor);
}

/**
 * Task line totals in dollars, split by {@link splitLineTotals}. Timed tasks match
 * {@link jobToLineItems} so the preview and saved invoice split the same cents. Ties go by
 * the line text as the saved invoice settles them, then by what prices the line (rate tags,
 * "Didn't finish"), which the invoice can't see but the discounts read.
 * @param tasks - Task lines, in display order.
 * @returns Each task's line total, in the same order.
 */
export function taskLineTotals(tasks: readonly TaskLine[]): number[] {
  return splitLineTotals(
    tasks.map((t): LineAmountInput => ({
      qty: t.qty,
      unitPrice: t.unitPrice,
      description: t.description,
      tieKey: [
        t.baseRateId ?? "",
        [...(t.modifierIds ?? [])].sort().join(","),
        t.unsuccessful ? "1" : "0",
      ].join("|"),
      ...(t.minutes != null && isHourlyTask(t) && { minutes: t.minutes }),
    })),
  );
}

/**
 * Each task line's share of a flat labour surcharge: its billed minutes at `perHour`, whatever
 * the line's own rate. Only paid hourly lines carry it, so flat-fee, free and credit lines add
 * nothing, and travel and parts never do.
 * @param tasks - Task lines, after the minimum-billable floor.
 * @param lineTotals - Each line's printed total, from {@link taskLineTotals}.
 * @param perHour - Surcharge in $/hr (0 = none).
 * @returns Each line's unrounded share.
 */
function surchargeByTask(
  tasks: readonly TaskLine[],
  lineTotals: readonly number[],
  perHour: number,
): number[] {
  return tasks.map((t, i) =>
    perHour > 0 && isHourlyTask(t) && lineTotals[i]! > 0 ? (taskMinutes(t) * perHour) / 60 : 0,
  );
}

/**
 * Converts a job calculation into invoice line items: one per task and part, plus travel.
 * Mirrors {@link calcJobTotal}'s {@link MIN_TRAVEL_CHARGE} and {@link enforceMinBillable} floors.
 * @param job - Job calculation with tasks, parts, and travel.
 * @param surcharge - Date-based labour surcharge, or null; adds one surcharge line.
 * @param minTravelCharge - Minimum auto-travel charge (live pricing setting); defaults to the code const.
 * @param minBillableMins - Minimum billable labour minutes (live pricing setting); defaults to the code const.
 * @returns Array of line items ready for an invoice.
 */
export function jobToLineItems(
  job: JobCalculation,
  surcharge: LabourSurcharge | null = null,
  minTravelCharge: number = MIN_TRAVEL_CHARGE,
  minBillableMins: number = MIN_BILLABLE_MINS,
): LineItem[] {
  const items: LineItem[] = [];
  const tasks = enforceMinBillable(job.tasks, minBillableMins);
  const lineTotals = taskLineTotals(tasks);
  for (const [i, task] of tasks.entries()) {
    const lineTotal = lineTotals[i]!;
    items.push({
      description: task.description,
      qty: task.qty,
      unitPrice: task.unitPrice,
      lineTotal,
      // Billed minutes on hourly rows so the invoice renders h:mm.
      ...(task.minutes != null && isHourlyTask(task) && { minutes: task.minutes }),
    });
  }

  if (surcharge) {
    const shares = surchargeByTask(tasks, lineTotals, surcharge.perHour);
    const amount = roundCents(shares.reduce((s, share) => s + share, 0));
    if (amount > 0) {
      items.push({
        description: `${surcharge.label} (+${formatMoneyCompact(surcharge.perHour)}/hr)`,
        qty: 1,
        unitPrice: amount,
        lineTotal: amount,
      });
    }
  }

  for (const part of job.parts) {
    const cost = roundCents(part.cost);
    items.push({
      description: part.description,
      qty: 1,
      unitPrice: cost,
      lineTotal: cost,
    });
  }

  const { tripTotal, storeRuns } = splitTravel(job.travelEntries, minTravelCharge);
  if (tripTotal > 0) {
    // Drive minutes for "Round-trip travel (46 min drive)"; a missing back leg uses outbound.
    const driveMins = job.travelEntries.reduce((sum, e) => {
      if (!isTripDrive(e) || !e.durationMinsOneWay) return sum;
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
  /** Modifier deltas saved when the promo was created; a flat promo prices modified lines with these. */
  lockedDeltas?: LockedDelta[];
}

/** A date-based labour surcharge as {@link jobToLineItems} prints it. */
export interface LabourSurcharge {
  /** Line wording without the amount, e.g. "Weekend surcharge". */
  label: string;
  /** Dollars added to every billed labour hour, whatever that line's own rate. */
  perHour: number;
}

/** Live pricing values threaded into {@link calcJobTotal}; defaults are the code consts. */
export interface JobPricing {
  gstRegistered: boolean;
  minTravelCharge: number;
  /** Minimum billable labour minutes; the whole-job floor applied by {@link enforceMinBillable}. */
  minBillableMins: number;
  /** Date-based labour surcharge in $/hr (public holiday 25, weekend 10), else 0. */
  surchargePerHour?: number;
  /** Fraction charged for an unsuccessful visit (e.g. 0.5 = half); defaults to 0.5. */
  unsuccessfulFactor?: number;
  /** RateConfig id of the "Business" modifier; its labour is excluded from promos. */
  businessModifierId?: string | null;
  /** Undiscounted Standard $/hr; a flat promo takes (Standard - flat) off every home-rate hour. */
  standardRate?: number | null;
  /** Live rate list, so a flat promo floors each line at the promo price for its tags. */
  rates?: RateConfig[];
  /**
   * Gold Card share off home labour (0.1 = 10%), taken after the promo; business work gets
   * none. 0 or absent when not ticked.
   */
  goldCardPercent?: number;
  /**
   * Task-timing settings for {@link collapseToWindow} and {@link explicitRoundingAllowanceMins};
   * not read by {@link calcJobTotal}.
   * Falls back to {@link TASK_TIMING_FALLBACK}.
   */
  taskTiming?: TaskTimingConfig;
}

/**
 * Whether a task carries the Business modifier: business labour, which promos and the Gold
 * Card skip.
 * @param task - The task line to classify.
 * @param businessModifierId - RateConfig id of the Business modifier, or null when there's none.
 * @returns True when the line is business labour.
 */
function isBusinessTask(
  task: Pick<TaskLine, "modifierIds">,
  businessModifierId: string | null | undefined,
): boolean {
  return !!businessModifierId && (task.modifierIds ?? []).includes(businessModifierId);
}

/**
 * Promo discount on a job's labour only (hourly task lines). Exported for
 * scripts/check-promo-pricing.ts.
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
 * {@link computeJobPromoDiscount}'s total plus each task line's unrounded share (0 for
 * skipped lines), so {@link calcJobTotal} can apply the unsuccessful discount after the promo.
 * @param job - Job calculation.
 * @param resolvedPromo - Active promo or null, before spend narrows it.
 * @param travelTotal - The job's travel charge, which a free-travel promo discounts.
 * @param businessModifierId - Modifier marking business labour, which promos skip.
 * @param preDiscountSubtotal - The job's subtotal before any discount, which selects a tier.
 * @param standardRate - Undiscounted Standard $/hr, which a flat promo's per-hour cut is taken from.
 * @param rates - Live rate list, which floors each line at the promo price for its rate tags.
 * @returns The rounded discount, each task line's unrounded share of it, each line's hourly
 * rate under the promo (null where it didn't change the rate), and whether it came off the
 * drive (free travel) rather than labour.
 */
function jobPromoBreakdown(
  job: JobCalculation,
  resolvedPromo: JobPromo | null,
  travelTotal: number,
  businessModifierId?: string | null,
  preDiscountSubtotal?: number,
  standardRate?: number | null,
  rates?: RateConfig[],
): { total: number; byTask: number[]; rateByTask: (number | null)[]; offTravel: boolean } {
  const none = {
    total: 0,
    byTask: job.tasks.map(() => 0),
    rateByTask: job.tasks.map(() => null),
    offTravel: false,
  };
  // Narrow to the band the pre-discount subtotal earns, as the public estimate does.
  // Without a subtotal a tiered promo can't apply.
  const promo = promoForSpend(resolvedPromo, preDiscountSubtotal ?? 0);
  if (!promo) return none;

  // A travel promo never touches the labour subtotal.
  if (promo.discountType === "free_travel" && promo.travelPercent != null) {
    // Any business work makes it a business visit, so the drive isn't discounted either.
    if (job.tasks.some((t) => isBusinessTask(t, businessModifierId))) return none;
    const charged = Math.min(1, Math.max(0, promo.travelPercent));
    return { ...none, total: roundCents(travelTotal * (1 - charged)), offTravel: true };
  }

  /**
   * Whether the promo discounts a task: non-business hourly labour ({@link isHourlyTask}),
   * checked per task so a mixed job discounts only its home-rate lines.
   * @param t - The task line to classify.
   * @returns True when the promo applies to the line.
   */
  const isDiscounted = (t: (typeof job.tasks)[number]): boolean =>
    isHourlyTask(t) && !isBusinessTask(t, businessModifierId);
  // Line totals in the cents jobToLineItems and calcJobTotal print. A raw sum discounts a
  // base the invoice never shows, landing the promo a cent off.
  const lineTotals = taskLineTotals(job.tasks);
  /**
   * Each task's share from a per-line rule, 0 for lines the promo skips.
   * @param rule - The discount on one discounted line, given the task and its line total.
   * @returns Shares in `job.tasks` order.
   */
  const shares = (rule: (t: (typeof job.tasks)[number], line: number) => number): number[] =>
    job.tasks.map((t, i) => (isDiscounted(t) ? rule(t, lineTotals[i]!) : 0));
  const labourSubtotal = roundCents(
    job.tasks.reduce((s, t, i) => (isDiscounted(t) ? s + lineTotals[i]! : s), 0),
  );
  if (labourSubtotal <= 0) return none;

  if (promo.flatHourlyRate !== null) {
    const flat = promo.flatHourlyRate;
    // With Standard known, cut (Standard - flat) off every home-rate hour, as
    // applyPromoToHourlyRate does, capped at the line.
    const cut = standardRate != null ? Math.max(0, standardRate - flat) : null;
    // Per line, never netted across the job: a line already under the flat rate stays put.
    const hourCuts = job.tasks.map((t) => {
      if (!isDiscounted(t)) return 0;
      // A "No base" row floors at the flat rate, never more than the cut.
      if (t.baseRateId == null) {
        const toFlat = Math.max(0, t.unitPrice - flat);
        return cut == null ? toFlat : Math.min(cut, toFlat);
      }
      // No rate list to floor against: the line takes the plain cut.
      if (cut != null && !rates) return cut;
      const mods = (t.modifierIds ?? [])
        .map((id) => rates?.find((r) => r.id === id))
        .filter((m): m is RateConfig => !!m);
      const shift = lockedDeltaShift(promo.lockedDeltas, mods);
      // Floor the hour at the promo price for the line's tags: live rate less the cut, with
      // its modifiers at their locked deltas. E.g. at an old $75 Standard the full $35 cut
      // would bill $40/hr, under the $65 promised.
      const live =
        cut != null && rates ? effectiveHourlyRate(rates, t.baseRateId, t.modifierIds) : 0;
      if (cut != null && live > 0) {
        const promoPrice = Math.max(0, live + shift - cut);
        return Math.min(Math.max(0, live - promoPrice), Math.max(0, t.unitPrice - promoPrice));
      }
      // Base row gone or no Standard to cut from: the flat rate plus the line's modifier
      // deltas (locked where the promo locked them), so At home still bills the promised $50.
      const deltas = mods.reduce((s, m) => s + (m.hourlyDelta ?? 0), 0);
      const toPromo = Math.max(0, t.unitPrice - Math.max(0, flat + deltas + shift));
      return cut == null ? toPromo : Math.min(toPromo, Math.max(0, cut - shift));
    });
    const byTask = job.tasks.map((t, i) => Math.min(lineTotals[i]!, t.qty * hourCuts[i]!));
    const rateByTask = job.tasks.map((t, i) =>
      hourCuts[i]! > 0 ? Math.max(0, roundCents(t.unitPrice - hourCuts[i]!)) : null,
    );
    // Gap between the rounded lines at each rate: 4h20m is $433.33 at $100/hr and
    // $281.67 at $65/hr, so $151.66. Rounding the raw cut ($151.667) bills a cent under.
    // Only the discounted lines are re-split, so an untouched $65 row can't share their cents.
    const cutIdx = job.tasks.flatMap((_, i) => (rateByTask[i] != null ? [i] : []));
    const promoLineTotals = taskLineTotals(
      cutIdx.map((i) => ({ ...job.tasks[i]!, unitPrice: rateByTask[i]! })),
    );
    const total = roundCents(
      cutIdx.reduce((s, i) => s + lineTotals[i]!, 0) -
        promoLineTotals.reduce((s, line) => s + line, 0),
    );
    return { ...none, total, byTask, rateByTask };
  }
  if (promo.percentDiscount !== null) {
    const pct = Math.max(0, Math.min(1, promo.percentDiscount));
    return {
      ...none,
      total: roundCents(labourSubtotal * pct),
      byTask: shares((_, line) => line * pct),
      rateByTask: job.tasks.map((t) =>
        isDiscounted(t) && pct > 0 ? roundCents(t.unitPrice * (1 - pct)) : null,
      ),
    };
  }
  if (promo.discountType === "fixed_amount" && promo.fixedAmount != null) {
    // Capped at the labour subtotal, as applyPromoToQuote does, so it never eats into travel.
    const amount = Math.min(Math.max(0, promo.fixedAmount), labourSubtotal);
    return {
      ...none,
      total: roundCents(amount),
      byTask: shares((_, line) => (amount * line) / labourSubtotal),
    };
  }
  return none;
}

/**
 * Cost breakdown for a job. Promo and unsuccessful discounts hit labour only. GST follows
 * {@link GST_REGISTERED} (see {@link calcInvoiceTotals}); {@link MIN_TRAVEL_CHARGE} and
 * {@link enforceMinBillable} floors apply.
 * @param jobIn - Job calculation with tasks, parts, and travel.
 * @param promo - Optional active promo to apply.
 * @param pricing - Live pricing (GST, min travel, min billable, date surcharge); defaults to the code consts.
 * @returns Cost breakdown with promo + unsuccessful discounts split out, and the rate pair
 * the promo billed at for the invoice's promo note.
 */
export function calcJobTotal(
  jobIn: JobCalculation,
  promo: JobPromo | null = null,
  // Built at call time to avoid a circular-import TDZ with the pricing-policy module.
  pricing: JobPricing = {
    gstRegistered: GST_REGISTERED,
    minTravelCharge: MIN_TRAVEL_CHARGE,
    minBillableMins: MIN_BILLABLE_MINS,
  },
): {
  tasksTotal: number;
  partsTotal: number;
  travelTotal: number;
  surchargeTotal: number;
  subtotal: number;
  promoDiscount: number;
  /** The promo's before/after hourly rate across its lines, or null when they differ or don't reproduce the bill. */
  promoRate: PromoRateSummary | null;
  goldCardDiscount: number;
  unsuccessfulDiscount: number;
  /** What couldn't be fixed and the labour the discount came off, or null when there's none. */
  unsuccessfulNote: string | null;
  gstAmount: number;
  total: number;
} {
  // Floor once, up front, so every labour figure below matches the invoice lines.
  const job = { ...jobIn, tasks: enforceMinBillable(jobIn.tasks, pricing.minBillableMins) };
  // Sum the per-line cents jobToLineItems prints: this preview and the saved invoice must
  // land on the same cent.
  const lineTotals = taskLineTotals(job.tasks);
  const tasksTotal = roundCents(lineTotals.reduce((s, line) => s + line, 0));
  // Per part, as each prints on its own invoice line.
  const partsTotal = roundCents(job.parts.reduce((s, p) => s + roundCents(p.cost), 0));
  const { driveTotal, total: travelTotal } = splitTravel(
    job.travelEntries,
    pricing.minTravelCharge,
  );
  // The date surcharge (public holiday, weekend or after hours) is a flat $/hr on paid hourly
  // lines, never travel or parts; summed as jobToLineItems sums it, so the cents match.
  const surchargeShares = surchargeByTask(job.tasks, lineTotals, pricing.surchargePerHour ?? 0);
  const surchargeTotal = roundCents(surchargeShares.reduce((s, share) => s + share, 0));
  const subtotal = roundCents(tasksTotal + partsTotal + travelTotal + surchargeTotal);
  const {
    total: promoDiscount,
    byTask: promoByTask,
    rateByTask: promoRateByTask,
    offTravel: promoOffTravel,
  } = jobPromoBreakdown(
    job,
    promo,
    // Free travel covers the drive only, not store runs, parking or tolls.
    driveTotal,
    pricing.businessModifierId,
    // Spend thresholds and tier bands are judged on this pre-discount subtotal.
    subtotal,
    pricing.standardRate,
    pricing.rates,
  );
  // Gold Card: a share off what home labour (hourly lines plus their surcharge) still costs
  // after the promo, so $65 flat then 10% bills $58.50. Business work gets none, and a
  // free-travel promo leaves labour alone.
  const goldCut = Math.min(1, Math.max(0, pricing.goldCardPercent ?? 0));
  /**
   * Whether a line is business labour, which the Gold Card skips.
   * @param t - The task line to classify.
   * @returns True when the line carries the Business modifier.
   */
  const isBusiness = (t: TaskLine): boolean => isBusinessTask(t, pricing.businessModifierId);
  const goldLabour = roundCents(
    job.tasks.reduce((s, t, i) => (isHourlyTask(t) && !isBusiness(t) ? s + lineTotals[i]! : s), 0),
  );
  // With no business work the printed surcharge line counts whole, so the 10% matches the
  // invoice lines to the cent; otherwise only the home lines' share of it.
  const goldSurcharge = job.tasks.some((t) => isHourlyTask(t) && isBusiness(t))
    ? job.tasks.reduce((s, t, i) => (isBusiness(t) ? s : s + surchargeShares[i]!), 0)
    : surchargeTotal;
  const labourPromo = promoOffTravel ? 0 : promoDiscount;
  const goldCardDiscount =
    goldCut > 0 ? Math.max(0, roundCents((goldLabour + goldSurcharge - labourPromo) * goldCut)) : 0;
  // Fraction removed from an unsuccessful line: 1 - the charged share.
  const unsuccessfulCut = 1 - (pricing.unsuccessfulFactor ?? 0.5);
  // Halve what was due after the promo and Gold Card (35% off then half bills 32.5%, not
  // 15%). The line's surcharge halves too: 2h at $65 on a $25/hr holiday bills $90, half of $180.
  const unsuccessfulBase = job.tasks.reduce((s, t, i) => {
    if (!isHourlyTask(t) || !(job.unsuccessful || t.unsuccessful)) return s;
    const kept = isBusiness(t) ? 1 : 1 - goldCut;
    return s + (lineTotals[i]! + surchargeShares[i]!) * kept - (promoByTask[i] ?? 0) * kept;
  }, 0);
  const unsuccessfulDiscount = Math.max(0, roundCents(unsuccessfulBase * unsuccessfulCut));
  // A whole visit that failed names no lines: all its labour is the base.
  const unsuccessfulLines = job.unsuccessful
    ? []
    : job.tasks.filter((t) => isHourlyTask(t) && t.unsuccessful).map((t) => t.description);
  // GST on the discounted amount (IRD price-reduction treatment), clamped at 0 like
  // calcInvoiceTotals.
  const taxableAmount = Math.max(
    0,
    roundCents(subtotal - promoDiscount - goldCardDiscount - unsuccessfulDiscount),
  );
  const gstAmount = pricing.gstRegistered ? calcGstFromInclusive(taxableAmount, GST_RATE) : 0;
  return {
    tasksTotal,
    partsTotal,
    travelTotal,
    surchargeTotal,
    subtotal,
    promoDiscount,
    promoRate:
      promoDiscount > 0
        ? promoRateSummary(job.tasks, promoRateByTask, lineTotals, promoDiscount)
        : null,
    goldCardDiscount,
    unsuccessfulDiscount,
    unsuccessfulNote:
      unsuccessfulDiscount > 0
        ? unsuccessfulNote(
            unsuccessfulLines,
            roundCents(unsuccessfulBase),
            pricing.unsuccessfulFactor ?? 0.5,
          )
        : null,
    gstAmount,
    total: taxableAmount,
  };
}

/**
 * The single before/after hourly pair a promo billed its lines at, summing their minutes.
 * Null when lines started or ended at different rates, since one pair would misstate some,
 * or when the pair times the minutes doesn't land on the billed cents: 12.5% off $65 is
 * $56.875/hr, and "$56.88/hr" over 13 hr 10 min reads 7c over what was charged.
 * @param tasks - The job's task lines, after the minimum-billable floor.
 * @param rateByTask - Each line's rate under the promo, null where it didn't change the rate.
 * @param lineTotals - Each line's printed total at its full rate.
 * @param promoDiscount - The promo's rounded discount, all of it off these lines.
 * @returns The pair with its minutes, or null.
 */
function promoRateSummary(
  tasks: readonly TaskLine[],
  rateByTask: readonly (number | null)[],
  lineTotals: readonly number[],
  promoDiscount: number,
): PromoRateSummary | null {
  let summary: PromoRateSummary | null = null;
  let full = 0;
  for (const [i, t] of tasks.entries()) {
    const after = rateByTask[i];
    if (after == null) continue;
    const mins = t.minutes ?? Math.round(t.qty * 60);
    full += lineTotals[i]!;
    if (!summary) summary = { mins, before: t.unitPrice, after };
    else if (summary.before !== t.unitPrice || summary.after !== after) return null;
    else summary.mins += mins;
  }
  if (!summary) return null;
  const { mins, before, after } = summary;
  const exact =
    roundCents((mins * before) / 60) === roundCents(full) &&
    roundCents((mins * after) / 60) === roundCents(full - promoDiscount);
  return exact ? summary : null;
}
