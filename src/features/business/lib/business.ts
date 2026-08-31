// src/features/business/lib/business.ts
/**
 * @description Core business calculation and display helpers - NZD/date
 * formatting, GST extraction, billable-minute and hourly-rate maths,
 * job-to-line-item building, invoice totals, and admin minute-count display.
 * Shared by the calculator, invoice, ledger, and admin booking views.
 */
import {
  BILLING_INCREMENT_MINS,
  GST_RATE,
  GST_REGISTERED,
  MIN_BILLABLE_MINS,
} from "@/features/business/lib/pricing-policy";
import type {
  JobCalculation,
  LineItem,
  RateConfig,
  TaskLine,
  TravelEntry,
} from "@/features/business/types/business";
import { formatDateSlash } from "@/shared/lib/date-format";
import { nzTodayKey } from "@/shared/lib/timezone-utils";

/**
 * Minimum travel cost (NZD) below which a calculated travel charge is
 * skipped rather than added to the invoice - a sub-$10 line item looks petty.
 * The travelInfo is still surfaced in the UI so the operator can add it manually.
 */
export const MIN_TRAVEL_CHARGE = 10;

/**
 * Formats a number as NZD currency string with the sign before the dollar.
 * @param amount - Amount in dollars (positive or negative).
 * @returns Formatted currency string (e.g. "$1,234.56" or "-$1,234.56").
 */
export function formatNZD(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const body = Math.abs(amount)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${body}`;
}

/**
 * Money for customer-facing prose: whole dollars stay whole ("$65"), cents
 * appear only when they exist ("$7.50"). {@link formatNZD} always prints cents,
 * which reads wrong in a rate like "$65.00/hr", while bare arithmetic prints
 * "$7.5", which is not a price.
 * @param amount - Dollar amount.
 * @returns The formatted amount.
 */
export function formatMoneyCompact(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : formatNZD(amount);
}

/**
 * Formats a minute count as a compact "Xh Ym" string for admin display.
 * @param mins - Minutes (non-negative integer).
 * @returns "45 min" / "1h" / "1h 30m".
 */
export function formatMins(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Returns today's date as a YYYY-MM-DD string in NZ (Pacific/Auckland) time.
 * The ledger/invoice forms that default to "today" run for a NZ operator, and
 * UTC would show yesterday every NZ morning.
 * @returns ISO date string for today in NZ.
 */
export function todayISO(): string {
  return nzTodayKey();
}

/**
 * Extracts GST from a GST-inclusive amount.
 * @param amountIncl - Amount including GST
 * @param gstRate - GST rate as a decimal (e.g. 0.15)
 * @returns GST component, rounded to 2 decimal places
 */
export function calcGstFromInclusive(amountIncl: number, gstRate: number): number {
  return Math.round(((amountIncl * gstRate) / (1 + gstRate)) * 100) / 100;
}

/**
 * Splits a GST-inclusive amount into its GST component and GST-exclusive base.
 * Both ledger writers and the subscription recorders need the pair, and deriving
 * `amountExcl` separately is where the two drifted apart.
 * @param amountIncl - Amount including GST.
 * @param gstRate - GST rate as a decimal (e.g. 0.15).
 * @returns GST component and exclusive base, each rounded to 2 decimal places.
 */
export function splitGstInclusive(
  amountIncl: number,
  gstRate: number,
): { gstAmount: number; amountExcl: number } {
  const gstAmount = calcGstFromInclusive(amountIncl, gstRate);
  return { gstAmount, amountExcl: Math.round((amountIncl - gstAmount) * 100) / 100 };
}

/**
 * Invoice totals with an optional discount. GST mode is driven by
 * {@link GST_REGISTERED} in pricing-policy.ts. When false (today), gstAmount=0;
 * when true (future), gstAmount is back-calculated from the inclusive
 * total via {@link calcGstFromInclusive} and total stays equal to taxableAmount
 * (GST is already inside the displayed price). Discount is subtracted
 * before GST is computed, matching IRD's price-reduction treatment.
 * @param lineItems - Array of line items with qty and unit price.
 * @param promoDiscount - Optional dollar discount (e.g. from a promo snapshot).
 * @param gstRegistered - Live GST-registration flag (defaults to the constant).
 * @returns Subtotal (gross), GST amount, and total (post-discount, post-GST).
 */
export function calcInvoiceTotals(
  lineItems: { qty: number; unitPrice: number }[],
  promoDiscount = 0,
  gstRegistered: boolean = GST_REGISTERED,
): { subtotal: number; gstAmount: number; total: number } {
  // Round EACH line before summing, matching the lineTotal jobToLineItems stores and the
  // PDF prints. Summing unrounded lets the Total column disagree with the Subtotal under
  // it: two 35-min lines at $65/hr print $37.92 each but sum to $75.83, not $75.84.
  const subtotal =
    Math.round(
      lineItems.reduce((sum, item) => sum + Math.round(item.qty * item.unitPrice * 100) / 100, 0) *
        100,
    ) / 100;
  const taxableAmount = Math.max(0, Math.round((subtotal - promoDiscount) * 100) / 100);
  const gstAmount = gstRegistered ? calcGstFromInclusive(taxableAmount, GST_RATE) : 0;
  return {
    subtotal,
    gstAmount,
    total: taxableAmount,
  };
}

/**
 * Every key a persisted line item may carry. Must match the Prisma `LineItem`
 * composite type exactly: Prisma rejects a composite field it doesn't declare,
 * and an unguarded extra key turns that into a 500 on invoice create/update.
 * Rejecting here fails loudly as a 400 instead, and surfaces the mismatch in
 * local dev rather than in production.
 */
const LINE_ITEM_FIELDS = new Set(["description", "qty", "unitPrice", "lineTotal", "minutes"]);

/**
 * Validates one untrusted line-item payload before it reaches
 * {@link calcInvoiceTotals} or the database. Rejects non-object items, blank
 * descriptions, non-finite numerics (which would otherwise yield NaN totals or a
 * malformed persisted invoice), and any key outside {@link LINE_ITEM_FIELDS}.
 * @param item - Candidate line item from a request body.
 * @returns True when the item carries only known fields, a non-empty description, finite qty, unit price and line total, and minutes either absent or finite.
 */
export function isValidLineItem(item: unknown): item is LineItem {
  if (!item || typeof item !== "object") return false;
  if (!Object.keys(item).every((key) => LINE_ITEM_FIELDS.has(key))) return false;
  const { description, qty, unitPrice, lineTotal, minutes } = item as Record<string, unknown>;
  return (
    typeof description === "string" &&
    description.trim().length > 0 &&
    typeof qty === "number" &&
    Number.isFinite(qty) &&
    typeof unitPrice === "number" &&
    Number.isFinite(unitPrice) &&
    typeof lineTotal === "number" &&
    Number.isFinite(lineTotal) &&
    (minutes == null || (typeof minutes === "number" && Number.isFinite(minutes)))
  );
}

/**
 * Generates the next sequential invoice number in TTP-YYYY-XXXX format.
 * @param lastNumber - Last used invoice number, or null for first
 * @param yearCode - Financial year code (e.g. "2627")
 * @param prefix - Invoice prefix (default "TTP")
 * @returns Next formatted invoice number
 */
export function nextInvoiceNumber(
  lastNumber: string | null,
  yearCode: string,
  prefix: string = "TTP",
): string {
  if (!lastNumber) return `${prefix}-${yearCode}-0001`;
  // Match 4+ trailing digits so a 5-digit counter (10000+) still increments
  // instead of silently restarting the sequence at 0001.
  const match = lastNumber.match(/-(\d{4,})$/);
  if (!match) return `${prefix}-${yearCode}-0001`;
  const next = parseInt(match[1], 10) + 1;
  return `${prefix}-${yearCode}-${String(next).padStart(4, "0")}`;
}

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
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
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

/**
 * Total minutes contributed by hourly tasks. Flat-rate tasks (Travel, etc.)
 * carry no time so they're excluded.
 * @param tasks - Task lines from the calculator.
 * @returns Sum of hourly task minutes (`qty * 60`).
 */
export function hourlyTaskMinutes(tasks: TaskLine[]): number {
  return tasks.filter((t) => t.baseRateId != null).reduce((sum, t) => sum + t.qty * 60, 0);
}

/**
 * Overshoot allowance for operator-stated tasks: each explicit task's stated
 * duration rounds UP to the snap grid, so pinned tasks can exceed the raw
 * window by one step apiece. Overshoot within this allowance is rounding, not
 * an over-estimate to rebalance or warn on.
 * @param tasks - Task lines to assess.
 * @param snapMins - Live billing increment in minutes; defaults to the code fallback.
 * @returns Allowance in minutes (explicit hourly task count * snap step).
 */
export function explicitRoundingAllowanceMins(
  tasks: TaskLine[],
  snapMins: number = TASK_TIMING_FALLBACK.snapMins,
): number {
  return tasks.filter((t) => t.baseRateId != null && t.isExplicit).length * snapMins;
}

/**
 * Live task-timing values threaded in from pricing settings. Every consumer
 * reads the operator's settings; {@link TASK_TIMING_FALLBACK} is the in-code
 * default only, so editing Settings changes the apportionment everywhere.
 */
export interface TaskTimingConfig {
  /** Rounding granularity for task qty; the live `billingIncrementMins`. */
  snapMins: number;
  /** Minutes an `isShort` task is pinned to; the live `shortTaskMins`. */
  shortTaskMins: number;
  /** Minutes a floating task can shrink to before it's dropped; the live `minTaskMins`. */
  minTaskMins: number;
}

/**
 * Fallbacks matching the settings defaults. Literals rather than reads of
 * BILLING_INCREMENT_MINS et al: importing those here re-introduces a
 * circular-import TDZ with the pricing-policy module.
 */
export const TASK_TIMING_FALLBACK: TaskTimingConfig = {
  snapMins: 5,
  shortTaskMins: 15,
  minTaskMins: 5,
};

/**
 * Collapses task lines so their total hourly minutes fit the listed job window.
 * Pinned tasks (isShort or isExplicit) keep their parser-emitted qty - short
 * tasks at the live `shortTaskMins`, explicit tasks at whatever the operator
 * stated, with a one-snap-step-per-task overshoot allowance (see
 * {@link explicitRoundingAllowanceMins}) before an explicit task is dropped
 * for not fitting. The remaining floating tasks scale proportionally to fill what's
 * left of the window, so an over-long primary task absorbs more of the
 * correction than a correctly-sized one. Floating tasks that would scale
 * below the live `minTaskMins` are dropped, then the rest rescale. Snaps
 * qty to the live billing increment and parks any rounding remainder on the
 * largest floating survivor so totals match exactly. Flat-rate tasks pass through.
 * @param tasks - Task lines to collapse.
 * @param windowMin - Target window in minutes (`durationMins`).
 * @param timing - Live task-timing settings; defaults to {@link TASK_TIMING_FALLBACK}.
 * @returns Adjusted task list, count of dropped tasks, and whether any qty was rescaled.
 */
export function collapseToWindow(
  tasks: TaskLine[],
  windowMin: number,
  timing: TaskTimingConfig = TASK_TIMING_FALLBACK,
): { tasks: TaskLine[]; dropped: number; rescaled: boolean } {
  if (windowMin <= 0) return { tasks, dropped: 0, rescaled: false };
  const hourlyIn = tasks.filter((t) => t.baseRateId != null);
  const flat = tasks.filter((t) => t.baseRateId == null);
  if (hourlyIn.length === 0) return { tasks, dropped: 0, rescaled: false };

  // The classification below splits tasks into short / explicit / floating groups, so the
  // survivors have to be restored to the operator's order - otherwise a quick task leads
  // the invoice and the main work sinks. Clones carry their position via {@link derive}.
  const orderOf = new Map<TaskLine, number>();
  tasks.forEach((t, i) => orderOf.set(t, i));
  /**
   * {@link withMinutes} that carries the source task's input position onto the
   * clone, so {@link inInputOrder} can still place it.
   * @param task - Source task line.
   * @param mins - New duration in minutes.
   * @returns Updated task line, registered at the source task's position.
   */
  const derive = (task: TaskLine, mins: number): TaskLine => {
    const next = withMinutes(task, mins);
    orderOf.set(next, orderOf.get(task) ?? 0);
    return next;
  };
  /**
   * Restores input order across the classification groups.
   * @param list - Surviving task lines in group order.
   * @returns The same lines ordered as the operator listed them.
   */
  const inInputOrder = (list: TaskLine[]): TaskLine[] =>
    [...list].sort((a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0));

  // Already fits - nothing to collapse, and minutes are exact so there is no
  // rounding drift left to park.
  if (sumTaskMinutes(hourlyIn) <= windowMin) {
    return { tasks, dropped: 0, rescaled: false };
  }

  // Pin short tasks at the operator's quick-task time and drop any that don't fit.
  // isExplicit beats isShort - a stated duration is the operator's own measurement, so it
  // keeps its qty. The parser emits the flags exclusive; this is the guard.
  const short: TaskLine[] = hourlyIn
    .filter((t) => t.isShort && !t.isExplicit)
    .map((t) => derive(t, timing.shortTaskMins));
  let dropped = 0;
  while (short.length * timing.shortTaskMins > windowMin) {
    short.pop();
    dropped++;
  }

  // Explicit tasks keep their parser-emitted qty. Stated durations round UP to
  // the snap grid, so tolerate one step of overshoot per explicit task; drop
  // (newest first) only genuine overflow beyond that.
  const explicit: TaskLine[] = hourlyIn.filter((t) => t.isExplicit);
  const shortMin = short.length * timing.shortTaskMins;
  while (
    explicit.length > 0 &&
    shortMin + sumTaskMinutes(explicit) > windowMin + explicit.length * timing.snapMins
  ) {
    explicit.pop();
    dropped++;
  }
  const pinnedMin = shortMin + sumTaskMinutes(explicit);

  let floating: TaskLine[] = hourlyIn.filter((t) => !t.isShort && !t.isExplicit);
  const remainingMin = windowMin - pinnedMin;

  if (floating.length === 0) {
    // Nothing floating: pinned tasks stand as-is, so only report a rescale
    // when something was actually dropped - otherwise the caller would toast
    // "Rebalanced tasks" over an untouched list.
    return {
      tasks: inInputOrder([...short, ...explicit, ...flat]),
      dropped,
      rescaled: dropped > 0,
    };
  }

  if (remainingMin <= 0) {
    // Pinned tasks already cover the whole window; drop every floating one.
    dropped += floating.length;
    return {
      tasks: inInputOrder([...short, ...explicit, ...flat]),
      dropped,
      rescaled: true,
    };
  }

  // Scale floating tasks proportionally to fill remainingMin; drop tasks that
  // would land below the operator's smallest-task time and rescale until
  // everything fits.
  while (floating.length > 0) {
    const sum = sumTaskMinutes(floating);
    if (sum <= remainingMin) break;
    const multiplier = remainingMin / sum;
    const scaled = floating.map((t) => ({ task: t, scaledMin: t.qty * 60 * multiplier }));
    const tooSmall = scaled.filter((s) => s.scaledMin < timing.minTaskMins);
    if (tooSmall.length === 0) {
      floating = scaled.map((s) => derive(s.task, snapMinutes(s.scaledMin, timing.snapMins)));
      break;
    }
    scaled.sort((a, b) => a.scaledMin - b.scaledMin);
    const removed = scaled[0].task;
    floating = floating.filter((t) => t !== removed);
    dropped++;
  }

  // Park rounding remainder on the largest floating survivor so totals match.
  const combined = [...short, ...explicit, ...floating];
  if (combined.length > 0) {
    const error = windowMin - sumTaskMinutes(combined);
    if (error !== 0 && floating.length > 0) {
      let biggestIdx = 0;
      for (let i = 1; i < floating.length; i++) {
        if (floating[i].qty > floating[biggestIdx].qty) biggestIdx = i;
      }
      const adjustedMin = Math.max(timing.minTaskMins, floating[biggestIdx].qty * 60 + error);
      floating[biggestIdx] = derive(floating[biggestIdx], adjustedMin);
    }
  }

  return {
    tasks: inInputOrder([...short, ...explicit, ...floating, ...flat]),
    dropped,
    rescaled: true,
  };
}

/**
 * Rounds a minute value to the nearest task-qty snap step.
 * @param mins - Raw minutes.
 * @param snapMins - Live billing increment in minutes; defaults to the code fallback.
 * @returns Minutes rounded to the nearest snap step.
 */
function snapMinutes(mins: number, snapMins: number = TASK_TIMING_FALLBACK.snapMins): number {
  return Math.round(mins / snapMins) * snapMins;
}

/**
 * A task's billed minutes. Prefers the authoritative `minutes`, falling back to
 * the decimal-hour `qty` for rows that predate it (manual flat lines, legacy
 * drafts).
 * @param task - Task line.
 * @returns Billed minutes.
 */
export function taskMinutes(task: TaskLine): number {
  return task.minutes ?? task.qty * 60;
}

/**
 * Total minutes across the given task lines.
 * @param arr - Task lines.
 * @returns Sum of minute durations.
 */
function sumTaskMinutes(arr: TaskLine[]): number {
  return arr.reduce((s, t) => s + taskMinutes(t), 0);
}

/**
 * Returns a clone of `task` billed for `mins` whole minutes.
 *
 * `minutes` is the authoritative figure; `qty` is it in hours, deliberately
 * NOT rounded to 2 dp. Two decimals cannot represent a 5-minute grid - only
 * 15/30/45/60 land exactly - so rounding here is what used to make a 140-minute
 * job bill 139.8 or 140.4 and never 140. Carrying full precision keeps
 * `qty * unitPrice` exact everywhere it is summed.
 * @param task - Source task line.
 * @param mins - New duration in minutes; rounded to a whole minute.
 * @returns Updated task line.
 */
function withMinutes(task: TaskLine, mins: number): TaskLine {
  const minutes = Math.round(mins);
  const qty = minutes / 60;
  return {
    ...task,
    minutes,
    qty,
    lineTotal: Math.round(qty * task.unitPrice * 100) / 100,
  };
}

/**
 * Formats billed time for an invoice's quantity column as h:mm ("2:20", "0:45").
 * Chosen over decimal hours because the column then visibly sums to the session
 * length, and over a bare minute count because nothing invites a reader to
 * multiply it by the hourly rate.
 * @param mins - Billed minutes.
 * @returns h:mm string.
 */
export function formatBilledTime(mins: number): string {
  const whole = Math.max(0, Math.round(mins));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Quantity column text for one invoice line: h:mm for hourly labour, the plain
 * count for flat rows (travel, parts, a surcharge) and for invoices issued
 * before minutes were recorded.
 * @param item - Invoice line item.
 * @param item.qty - Decimal quantity (hours on labour rows, a count on flat rows).
 * @param item.minutes - Billed minutes; present only on hourly labour rows. Null on rows Prisma read back without the field.
 * @returns Text for the Qty cell.
 */
export function lineItemQtyLabel(item: { qty: number; minutes?: number | null }): string {
  return item.minutes == null ? String(item.qty) : formatBilledTime(item.minutes);
}

/**
 * Converts a duration in minutes to a human-readable label.
 * @param mins - Duration in minutes
 * @returns Formatted label (e.g. "1h 30min")
 */
export function minsToHoursLabel(mins: number): string {
  if (mins < 60) return `${mins}min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

/**
 * Composes the line-item description from device + action + optional details.
 * Single source of truth so AI-generated and operator-entered tasks all read
 * identically on the invoice and in the calculator preview.
 * @param device - Device tag (e.g. "Phone").
 * @param action - Action tag (e.g. "Setup").
 * @param details - Optional free-text qualifier appended after " - ".
 * @returns Composed string "Device action" / "Device action - details", or empty when device or action is missing.
 */
export function composeDescription(
  device: string | null | undefined,
  action: string | null | undefined,
  details?: string | null,
): string {
  if (!device || !action) return "";
  const base = `${device} ${action.toLowerCase()}`;
  const trimmed = details?.trim();
  return trimmed ? `${base} - ${trimmed}` : base;
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
 * Enforces the whole-job minimum-billable floor. When the hourly task lines
 * carry some time but sum below minBillableMins, grows the most significant
 * line so the billed labour is at least the minimum - the largest floating
 * (neither operator-stated nor quick) task, or the largest hourly task when
 * every line is pinned. A job with no hourly time stays at 0 so the floor never invents a
 * charge on an empty or parts-only job. Applied by both {@link calcJobTotal}
 * and {@link jobToLineItems} so the on-screen total and the issued invoice
 * agree, mirroring the {@link MIN_TRAVEL_CHARGE} floor.
 * @param tasks - Task lines (`qty` in decimal hours); flat-rate lines pass through untouched.
 * @param minBillableMins - Minimum billable labour minutes (live pricing setting); defaults to the code const.
 * @returns Task list with the floor applied, or the input unchanged when already at/above the minimum.
 */
export function enforceMinBillable(
  tasks: TaskLine[],
  minBillableMins: number = MIN_BILLABLE_MINS,
): TaskLine[] {
  if (minBillableMins <= 0) return tasks;
  const hourly = tasks.filter(isHourlyTask);
  const totalMin = sumTaskMinutes(hourly);
  if (totalMin <= 0 || totalMin >= minBillableMins) return tasks;
  // Land the deficit on the most significant line: the largest floating task,
  // falling back to the largest hourly task when every line is pinned.
  const floating = hourly.filter((t) => !t.isExplicit && !t.isShort);
  const pool = floating.length > 0 ? floating : hourly;
  let biggest = pool[0];
  for (const t of pool) if (t.qty > biggest.qty) biggest = t;
  const bumped = withMinutes(biggest, biggest.qty * 60 + (minBillableMins - totalMin));
  return tasks.map((t) => (t === biggest ? bumped : t));
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

  // Auto entries trigger the floor; manual-only entries (parking, etc.) don't.
  const rawTravelTotal = travelEntriesTotal(job.travelEntries);
  const hasAutoEntry = job.travelEntries.some((e) => e.isAuto && e.cost > 0);
  const travelTotal =
    hasAutoEntry && rawTravelTotal > 0 && rawTravelTotal < minTravelCharge
      ? minTravelCharge
      : rawTravelTotal;
  if (travelTotal > 0) {
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
      unitPrice: travelTotal,
      lineTotal: travelTotal,
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
 * @param promo - Active promo or null.
 * @param travelTotal - The job's travel charge, which a free-travel promo discounts.
 * @param businessModifierId - Modifier marking business labour, which promos skip.
 * @returns Discount in dollars.
 */
export function computeJobPromoDiscount(
  job: JobCalculation,
  promo: JobPromo | null,
  travelTotal: number,
  businessModifierId?: string | null,
): number {
  if (!promo) return 0;

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
    if (job.tasks.some(isBusinessTask)) return 0;
    const charged = Math.min(1, Math.max(0, promo.travelPercent));
    return Math.round(travelTotal * (1 - charged) * 100) / 100;
  }

  // A task is hourly if either: it has a baseRateId set (new rate model),
  // OR no flat rateConfigId. The double check survives stale AI output that
  // forgets to clear rateConfigId.
  const hourlyTasks = job.tasks
    .filter((t) => t.baseRateId != null || t.rateConfigId == null)
    // Business labour is out of scope for a promo. Checked per task rather than
    // per job so a mixed job discounts only its home-rate lines.
    .filter((t) => !isBusinessTask(t));
  const labourSubtotal = hourlyTasks.reduce((s, t) => s + t.qty * t.unitPrice, 0);
  if (labourSubtotal <= 0) return 0;

  if (promo.flatHourlyRate !== null) {
    const totalHours = hourlyTasks.reduce((s, t) => s + t.qty, 0);
    const promoTotal = totalHours * promo.flatHourlyRate;
    const discount = labourSubtotal - promoTotal;
    return discount > 0 ? Math.round(discount * 100) / 100 : 0;
  }
  if (promo.percentDiscount !== null) {
    const pct = Math.max(0, Math.min(1, promo.percentDiscount));
    return Math.round(labourSubtotal * pct * 100) / 100;
  }
  if (promo.discountType === "fixed_amount" && promo.fixedAmount != null) {
    // Capped at the labour subtotal, matching applyPromoToQuote: travel is the
    // operator's driving time rather than margin, so a discount larger than the
    // labour is capped instead of eating into it.
    return Math.round(Math.min(Math.max(0, promo.fixedAmount), labourSubtotal) * 100) / 100;
  }
  return 0;
}

/**
 * Whether a task line counts as labour. Hourly tasks (an explicit base rate, or
 * no rate config at all) are labour; flat-rate rows like Travel never are, so
 * they're excluded from the unsuccessful-work discount.
 * @param task - Task line to classify.
 * @returns True when the line is hourly labour.
 */
function isHourlyTask(task: TaskLine): boolean {
  return task.baseRateId != null || task.rateConfigId == null;
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
  const rawTravelTotal = travelEntriesTotal(job.travelEntries);
  // Auto entries trigger the floor; manual-only entries (parking, etc.) don't.
  const hasAutoEntry = job.travelEntries.some((e) => e.isAuto && e.cost > 0);
  const travelTotal =
    hasAutoEntry && rawTravelTotal > 0 && rawTravelTotal < pricing.minTravelCharge
      ? pricing.minTravelCharge
      : rawTravelTotal;
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
  const promoDiscount = computeJobPromoDiscount(
    job,
    promo,
    travelTotal,
    pricing.businessModifierId,
  );
  // Fraction removed from an unsuccessful line: 1 - the charged share.
  const unsuccessfulCut = 1 - (pricing.unsuccessfulFactor ?? 0.5);
  let unsuccessfulDiscount = 0;
  if (job.unsuccessful) {
    // Whole-job flag discounts every hourly task; per-task flags are subsumed
    // here so a task can't be discounted twice.
    unsuccessfulDiscount = Math.round(hourlyTasksTotal * unsuccessfulCut * 100) / 100;
  } else {
    // Per-task flags discount only the flagged hourly lines.
    const flaggedTasksTotal = job.tasks
      .filter((t) => t.unsuccessful && isHourlyTask(t))
      .reduce((s, t) => s + t.qty * t.unitPrice, 0);
    unsuccessfulDiscount = Math.round(flaggedTasksTotal * unsuccessfulCut * 100) / 100;
  }
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

/**
 * Advances a subscription's next due date by its frequency.
 * Uses UTC date methods to avoid DST issues. Month/year steps clamp to the last
 * day of the target month when the source day doesn't exist there (e.g. 31 Jan
 * monthly lands on 28/29 Feb, not 3 Mar), so a short target month can't roll the
 * due date into the following month.
 * @param current - Current nextDue date
 * @param frequency - Billing frequency
 * @returns New nextDue date
 */
export function advanceNextDue(current: Date, frequency: string): Date {
  const d = new Date(current);
  switch (frequency) {
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "fortnightly":
      d.setUTCDate(d.getUTCDate() + 14);
      break;
    case "monthly":
      addUTCMonthsClamped(d, 1);
      break;
    case "quarterly":
      addUTCMonthsClamped(d, 3);
      break;
    case "annually":
      addUTCMonthsClamped(d, 12);
      break;
  }
  return d;
}

/**
 * Adds whole months to a date in UTC, clamping the day to the last valid day of
 * the target month instead of letting {@link Date.setUTCMonth} overflow into the
 * next month. Mutates `d` in place.
 * @param d - Date to advance (mutated).
 * @param months - Whole months to add.
 */
function addUTCMonthsClamped(d: Date, months: number): void {
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // Last day of the now-current month; clamp the original day down to it.
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
}

/**
 * Builds a short income entry description from a job calculation.
 * @param job - Job calculation to summarise
 * @returns Human-readable description for the income record
 */
export function buildIncomeDescription(job: JobCalculation): string {
  const parts: string[] = [];
  if (job.tasks.length > 0) {
    parts.push(job.tasks.map((t) => t.description).join(", "));
  }
  if (job.durationMins > 0) {
    parts.push(`${minsToHoursLabel(job.durationMins)} labour`);
  }
  const today = formatDateSlash(new Date());
  return `Job: ${parts.join(" + ")} - ${today}`;
}
