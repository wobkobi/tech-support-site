import type {
  JobCalculation,
  LineItem,
  RateConfig,
  TaskLine,
  TravelEntry,
} from "@/features/business/types/business";
import { GST_REGISTERED, GST_RATE } from "@/features/business/lib/pricing-policy";
import { formatDateSlash } from "@/shared/lib/date-format";

/**
 * Minimum travel cost (NZD) below which a calculated travel charge is
 * skipped rather than added to the invoice. Short trips (a couple of km
 * to the nearest customers) would otherwise produce a sub-$10 line item
 * that's awkward to bill and looks petty. The travelInfo is still
 * surfaced in the UI so the operator can manually add it if they want.
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
 * Returns today's date as a YYYY-MM-DD string (local machine time).
 * @returns ISO date string for today
 */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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
 * UTC slash date "DD/MM/YYYY" - safe for server-side sheet writes.
 * @param date - Date to format.
 * @returns Formatted string.
 */
export function formatUTCDDMMYYYY(date: Date): string {
  return formatDateSlash(date, { utc: true });
}

/**
 * Invoice totals with an optional discount. GST mode is driven by
 * GST_REGISTERED in pricing-policy.ts. When false (today), gstAmount=0;
 * when true (future), gstAmount is back-calculated from the inclusive
 * total via calcGstFromInclusive and total stays equal to taxableAmount
 * (GST is already inside the displayed price). Discount is subtracted
 * before GST is computed, matching IRD's price-reduction treatment.
 * @param lineItems - Array of line items with qty and unit price.
 * @param promoDiscount - Optional dollar discount (e.g. from a promo snapshot).
 * @returns Subtotal (gross), GST amount, and total (post-discount, post-GST).
 */
export function calcInvoiceTotals(
  lineItems: { qty: number; unitPrice: number }[],
  promoDiscount = 0,
): { subtotal: number; gstAmount: number; total: number } {
  const subtotal =
    Math.round(lineItems.reduce((sum, item) => sum + item.qty * item.unitPrice, 0) * 100) / 100;
  const taxableAmount = Math.max(0, Math.round((subtotal - promoDiscount) * 100) / 100);
  const gstAmount = GST_REGISTERED ? calcGstFromInclusive(taxableAmount, GST_RATE) : 0;
  return {
    subtotal,
    gstAmount,
    total: taxableAmount,
  };
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
  const match = lastNumber.match(/-(\d{4})$/);
  if (!match) return `${prefix}-${yearCode}-0001`;
  const next = parseInt(match[1], 10) + 1;
  return `${prefix}-${yearCode}-${String(next).padStart(4, "0")}`;
}

/**
 * Rounds a duration up to the nearest 15-minute billing increment.
 * @param mins - Actual duration in minutes
 * @returns Billable duration rounded up to nearest 15 min
 */
export function billableMins(mins: number): number {
  if (mins <= 0) return 0;
  return Math.ceil(mins / 15) * 15;
}

/**
 * Minutes between two HH:MM strings on the same day. Empty/invalid inputs
 * collapse to 0 (matches the calculator's pre-existing behaviour). Returns 0
 * for reversed times so a half-typed session doesn't sneak negative minutes
 * into the aggregate. Cross-midnight handling is intentionally not done here -
 * use the duration override for overnight cases.
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
  return diff > 0 ? diff : 0;
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

/** Minimum minutes a task can shrink to before it's dropped as descriptive noise. */
const MIN_TASK_MINUTES = 5;
/** Rounding granularity for task qty after rebalancing (5-min steps). */
const TASK_QTY_SNAP_MIN = 5;
/** Minutes every isShort task is pinned to. Matches the AI's 0.25h SHORT-set assignment. */
const SHORT_TASK_MINUTES = 15;

/**
 * Collapses task lines so their total hourly minutes fit the listed job window.
 * Pinned tasks (isShort or isExplicit) keep their parser-emitted qty - short
 * tasks at {@link SHORT_TASK_MINUTES}, explicit tasks at whatever the operator
 * stated. The remaining floating tasks scale proportionally to fill what's
 * left of the window, so an over-long primary task absorbs more of the
 * correction than a correctly-sized one. Floating tasks that would scale
 * below {@link MIN_TASK_MINUTES} are dropped, then the rest rescale. Snaps
 * qty to 5-min increments and parks any rounding remainder on the largest
 * floating survivor so totals match exactly. Flat-rate tasks pass through.
 * @param tasks - Task lines to collapse.
 * @param windowMin - Target window in minutes (`durationMins`).
 * @returns Adjusted task list, count of dropped tasks, and whether any qty was rescaled.
 */
export function collapseToWindow(
  tasks: TaskLine[],
  windowMin: number,
): { tasks: TaskLine[]; dropped: number; rescaled: boolean } {
  if (windowMin <= 0) return { tasks, dropped: 0, rescaled: false };
  const hourlyIn = tasks.filter((t) => t.baseRateId != null);
  const flat = tasks.filter((t) => t.baseRateId == null);
  if (hourlyIn.length === 0) return { tasks, dropped: 0, rescaled: false };

  if (sumTaskMinutes(hourlyIn) <= windowMin) return { tasks, dropped: 0, rescaled: false };

  // Pin short tasks at 15 min each; drop any that don't fit the window.
  const short: TaskLine[] = hourlyIn
    .filter((t) => t.isShort)
    .map((t) => withMinutes(t, SHORT_TASK_MINUTES));
  let dropped = 0;
  while (short.length * SHORT_TASK_MINUTES > windowMin) {
    short.pop();
    dropped++;
  }

  // Explicit-but-not-short tasks keep their parser-emitted qty. Drop them
  // (newest first) only if the remaining window can't accommodate them.
  const explicit: TaskLine[] = hourlyIn.filter((t) => t.isExplicit && !t.isShort);
  const shortMin = short.length * SHORT_TASK_MINUTES;
  while (explicit.length > 0 && shortMin + sumTaskMinutes(explicit) > windowMin) {
    explicit.pop();
    dropped++;
  }
  const pinnedMin = shortMin + sumTaskMinutes(explicit);

  let floating: TaskLine[] = hourlyIn.filter((t) => !t.isShort && !t.isExplicit);
  const remainingMin = windowMin - pinnedMin;

  if (floating.length === 0) {
    return { tasks: [...short, ...explicit, ...flat], dropped, rescaled: true };
  }

  if (remainingMin <= 0) {
    // Pinned tasks already cover the whole window; drop every floating one.
    dropped += floating.length;
    return { tasks: [...short, ...explicit, ...flat], dropped, rescaled: true };
  }

  // Scale floating tasks proportionally to fill remainingMin; drop tasks that
  // would land below MIN_TASK_MINUTES and rescale until everything fits.
  while (floating.length > 0) {
    const sum = sumTaskMinutes(floating);
    if (sum <= remainingMin) break;
    const multiplier = remainingMin / sum;
    const scaled = floating.map((t) => ({ task: t, scaledMin: t.qty * 60 * multiplier }));
    const tooSmall = scaled.filter((s) => s.scaledMin < MIN_TASK_MINUTES);
    if (tooSmall.length === 0) {
      floating = scaled.map((s) => withMinutes(s.task, snapMinutes(s.scaledMin)));
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
      const adjustedMin = Math.max(MIN_TASK_MINUTES, floating[biggestIdx].qty * 60 + error);
      floating[biggestIdx] = withMinutes(floating[biggestIdx], adjustedMin);
    }
  }

  return { tasks: [...short, ...explicit, ...floating, ...flat], dropped, rescaled: true };
}

/**
 * Rounds a minute value to the nearest task-qty snap step.
 * @param mins - Raw minutes.
 * @returns Minutes rounded to the nearest {@link TASK_QTY_SNAP_MIN}.
 */
function snapMinutes(mins: number): number {
  return Math.round(mins / TASK_QTY_SNAP_MIN) * TASK_QTY_SNAP_MIN;
}

/**
 * Total minutes across the given task lines (`qty` is decimal hours).
 * @param arr - Task lines.
 * @returns Sum of minute durations.
 */
function sumTaskMinutes(arr: TaskLine[]): number {
  return arr.reduce((s, t) => s + t.qty * 60, 0);
}

/**
 * Returns a clone of `task` with `qty` set to `mins / 60` (rounded to 2 dp so
 * snapped minute totals never produce ugly `2.3333…` qty values) and
 * `lineTotal` recomputed against the existing unit price.
 * @param task - Source task line.
 * @param mins - New duration in minutes.
 * @returns Updated task line.
 */
function withMinutes(task: TaskLine, mins: number): TaskLine {
  const qty = Math.round((mins / 60) * 100) / 100;
  return {
    ...task,
    qty,
    lineTotal: Math.round(qty * task.unitPrice * 100) / 100,
  };
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
 * Mirrors the operator-facing preview in the Calculator and the persisted
 * description on TaskTemplate, so AI-generated and operator-entered tasks all
 * read identically on the invoice.
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
 * Finds a rate config by ID, falling back to the default rate.
 * @param rates - Array of rate configurations
 * @param id - Rate config ID to search for, or null for default
 * @returns Matching rate config, or null if none found
 */
export function matchRateById(rates: RateConfig[], id: string | null): RateConfig | null {
  if (id === null) return null;
  return rates.find((r) => r.id === id) ?? null;
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
 * Emits one Labour row (when hours + rate are set), one row per task, one row
 * per part, and a single Travel row summed from `travelEntries`.
 * @param job - Job calculation with time, tasks, parts.
 * @returns Array of line items ready for an invoice.
 */
export function jobToLineItems(job: JobCalculation): LineItem[] {
  const items: LineItem[] = [];

  if (job.durationMins > 0 && job.hourlyRate) {
    const billed = billableMins(job.durationMins);
    const hours = billed / 60;
    const rate = job.hourlyRate.ratePerHour ?? 0;
    const lineTotal = Math.round(hours * rate * 100) / 100;
    items.push({
      description: `Labour - ${minsToHoursLabel(billed)} @ ${formatNZD(rate)}/hr`,
      qty: 1,
      unitPrice: lineTotal,
      lineTotal,
    });
  }

  for (const task of job.tasks) {
    items.push({
      description: task.description,
      qty: task.qty,
      unitPrice: task.unitPrice,
      lineTotal: Math.round(task.qty * task.unitPrice * 100) / 100,
    });
  }

  for (const part of job.parts) {
    items.push({
      description: part.description,
      qty: 1,
      unitPrice: part.cost,
      lineTotal: part.cost,
    });
  }

  const travelTotal = travelEntriesTotal(job.travelEntries);
  if (travelTotal > 0) {
    items.push({
      description: "Travel",
      qty: 1,
      unitPrice: travelTotal,
      lineTotal: travelTotal,
    });
  }

  return items;
}

/** Active-promo shape consumed by `calcJobTotal`. Kept loose so business.ts doesn't depend on the wider promos module. */
export interface JobPromo {
  flatHourlyRate: number | null;
  percentDiscount: number | null;
}

/**
 * Promo discount on a job's labor only (time charge + hourly tasks).
 * @param job - Job calculation.
 * @param promo - Active promo or null.
 * @returns Discount in dollars.
 */
export function computeJobPromoDiscount(job: JobCalculation, promo: JobPromo | null): number {
  if (!promo) return 0;

  // A task is hourly if either: it has a baseRateId set (new rate model),
  // OR no flat rateConfigId. The double check survives stale AI output that
  // forgets to clear rateConfigId.
  const hourlyTasks = job.tasks.filter((t) => t.baseRateId != null || t.rateConfigId == null);
  const hourlyTasksTotal = hourlyTasks.reduce((s, t) => s + t.qty * t.unitPrice, 0);
  const hourlyTasksHours = hourlyTasks.reduce((s, t) => s + t.qty, 0);

  const billed = billableMins(job.durationMins);
  const timeHours = billed / 60;
  const timeCharge = Math.round(timeHours * (job.hourlyRate?.ratePerHour ?? 0) * 100) / 100;

  const laborSubtotal = timeCharge + hourlyTasksTotal;
  if (laborSubtotal <= 0) return 0;

  if (promo.flatHourlyRate !== null) {
    // Only count hours that actually contributed to laborSubtotal. When the
    // top-level rate is null, timeHours is "phantom" duration with no charge
    // behind it - including it inflates promoTotal and zeros the discount.
    const billedTimeHours = timeCharge > 0 ? timeHours : 0;
    const totalHours = billedTimeHours + hourlyTasksHours;
    const promoTotal = totalHours * promo.flatHourlyRate;
    const discount = laborSubtotal - promoTotal;
    return discount > 0 ? Math.round(discount * 100) / 100 : 0;
  }
  if (promo.percentDiscount !== null) {
    const pct = Math.max(0, Math.min(1, promo.percentDiscount));
    return Math.round(laborSubtotal * pct * 100) / 100;
  }
  return 0;
}

/**
 * Cost breakdown for a job. Promo discount applies to labour only; travel +
 * parts stay at full price. Unsuccessful-work flag halves the labour
 * portion. GST mode is driven by GST_REGISTERED (see calcInvoiceTotals);
 * job.gst is ignored. Travel floor (MIN_TRAVEL_CHARGE) only applies when an
 * auto entry contributed - manual-only travel passes through unchanged.
 * @param job - Job calculation with time, tasks, and parts.
 * @param promo - Optional active promo to apply.
 * @returns Cost breakdown with promo + unsuccessful discounts split out.
 */
export function calcJobTotal(
  job: JobCalculation,
  promo: JobPromo | null = null,
): {
  timeCharge: number;
  tasksTotal: number;
  partsTotal: number;
  travelTotal: number;
  subtotal: number;
  promoDiscount: number;
  unsuccessfulDiscount: number;
  gstAmount: number;
  total: number;
} {
  const billed = billableMins(job.durationMins);
  const hours = billed / 60;
  const rate = job.hourlyRate?.ratePerHour ?? 0;
  const timeCharge = Math.round(hours * rate * 100) / 100;
  const tasksTotal = job.tasks.reduce((s, t) => s + t.qty * t.unitPrice, 0);
  const partsTotal = job.parts.reduce((s, p) => s + p.cost, 0);
  const rawTravelTotal = travelEntriesTotal(job.travelEntries);
  // Auto entries trigger the floor; manual-only entries (parking, etc.) don't.
  const hasAutoEntry = job.travelEntries.some((e) => e.isAuto && e.cost > 0);
  const travelTotal =
    hasAutoEntry && rawTravelTotal > 0 && rawTravelTotal < MIN_TRAVEL_CHARGE
      ? MIN_TRAVEL_CHARGE
      : rawTravelTotal;
  const subtotal = Math.round((timeCharge + tasksTotal + partsTotal + travelTotal) * 100) / 100;
  const promoDiscount = computeJobPromoDiscount(job, promo);
  let unsuccessfulDiscount = 0;
  if (job.unsuccessful) {
    const hourlyTasksTotal = job.tasks
      .filter((t) => t.baseRateId != null || t.rateConfigId == null)
      .reduce((s, t) => s + t.qty * t.unitPrice, 0);
    const labourBase = timeCharge + hourlyTasksTotal;
    unsuccessfulDiscount = Math.round(labourBase * 0.5 * 100) / 100;
  }
  // GST applied to the discounted amount per NZ IRD price-reduction treatment.
  const taxableAmount = Math.round((subtotal - promoDiscount - unsuccessfulDiscount) * 100) / 100;
  const gstAmount = GST_REGISTERED ? calcGstFromInclusive(taxableAmount, GST_RATE) : 0;
  return {
    timeCharge,
    tasksTotal,
    partsTotal,
    travelTotal,
    subtotal,
    promoDiscount,
    unsuccessfulDiscount,
    gstAmount,
    total: taxableAmount,
  };
}

/**
 * Advances a subscription's next due date by its frequency.
 * Uses UTC date methods to avoid DST issues.
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
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "quarterly":
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case "annually":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
  return d;
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
