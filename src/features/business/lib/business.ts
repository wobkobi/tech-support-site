import type { JobCalculation, LineItem, RateConfig } from "@/features/business/types/business";
import { formatDateSlash } from "@/shared/lib/date-format";

/**
 * Formats a number as NZD currency string.
 * @param amount - Amount in dollars
 * @returns Formatted currency string (e.g. "$1,234.56")
 */
export function formatNZD(amount: number): string {
  return "$" + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * NZ slash date "DD/MM/YYYY" (local). Wrapper kept for existing imports.
 * @param date - Date or ISO string.
 * @returns Formatted string.
 */
export function formatNZDate(date: Date | string): string {
  return formatDateSlash(date);
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
 * Calculates invoice totals including optional GST and an optional promo
 * discount. The discount is subtracted from the gross subtotal before GST,
 * matching the Calculator's Summary panel and IRD's "discount = price
 * reduction" treatment.
 * @param lineItems - Array of line items with qty and unit price
 * @param gst - Whether to apply 15% GST
 * @param promoDiscount - Optional dollar discount (e.g. from a promo snapshot)
 * @returns Subtotal (gross), GST amount, and total (post-discount, post-GST)
 */
export function calcInvoiceTotals(
  lineItems: { qty: number; unitPrice: number }[],
  gst: boolean,
  promoDiscount = 0,
): { subtotal: number; gstAmount: number; total: number } {
  const subtotal =
    Math.round(lineItems.reduce((sum, item) => sum + item.qty * item.unitPrice, 0) * 100) / 100;
  const taxableAmount = Math.max(0, Math.round((subtotal - promoDiscount) * 100) / 100);
  const gstAmount = gst ? Math.round(taxableAmount * 0.15 * 100) / 100 : 0;
  return {
    subtotal,
    gstAmount,
    total: Math.round((taxableAmount + gstAmount) * 100) / 100,
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
 * Computes the effective hourly rate for a task by adding modifier deltas to
 * a base rate. E.g. Standard ($65) + At home (-$10) + Student (-$20) = $35.
 * @param rates - All rate configurations (used to look up by ID).
 * @param baseRateId - Base rate ID (must point to a rate with ratePerHour set).
 * @param modifierIds - Modifier rate IDs (each must point to a rate with hourlyDelta set).
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
  const sumDelta = ids.reduce((s, id) => {
    const mod = rates.find((r) => r.id === id);
    return s + (mod?.hourlyDelta ?? 0);
  }, 0);
  return Math.round((base.ratePerHour + sumDelta) * 100) / 100;
}

/**
 * Converts a job calculation into a flat array of invoice line items.
 * @param job - Job calculation with time, tasks, and parts
 * @returns Array of line items ready for an invoice
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

  if (job.travelCost) {
    items.push({
      description: "Travel",
      qty: 1,
      unitPrice: job.travelCost,
      lineTotal: job.travelCost,
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
 * Calculates the complete cost breakdown for a job. When `promo` is supplied
 * (and the job has labor), a `promoDiscount` is computed via
 * `computeJobPromoDiscount` and subtracted from the subtotal before GST.
 * Travel + parts are never discounted.
 * @param job - Job calculation with time, tasks, and parts.
 * @param promo - Optional active promo to apply.
 * @returns Cost breakdown including promoDiscount.
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
  gstAmount: number;
  total: number;
} {
  const billed = billableMins(job.durationMins);
  const hours = billed / 60;
  const rate = job.hourlyRate?.ratePerHour ?? 0;
  const timeCharge = Math.round(hours * rate * 100) / 100;
  const tasksTotal = job.tasks.reduce((s, t) => s + t.qty * t.unitPrice, 0);
  const partsTotal = job.parts.reduce((s, p) => s + p.cost, 0);
  const travelTotal = job.travelCost ?? 0;
  // Subtotal = gross (pre-promo); promo shown as its own line in the Summary.
  const subtotal = Math.round((timeCharge + tasksTotal + partsTotal + travelTotal) * 100) / 100;
  const promoDiscount = computeJobPromoDiscount(job, promo);
  // GST applies to the discounted amount per NZ IRD treatment.
  const taxableAmount = Math.round((subtotal - promoDiscount) * 100) / 100;
  const gstAmount = job.gst ? Math.round(taxableAmount * 0.15 * 100) / 100 : 0;
  return {
    timeCharge,
    tasksTotal,
    partsTotal,
    travelTotal,
    subtotal,
    promoDiscount,
    gstAmount,
    total: Math.round((taxableAmount + gstAmount) * 100) / 100,
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
  const today = formatNZDate(new Date());
  return `Job: ${parts.join(" + ")} - ${today}`;
}
