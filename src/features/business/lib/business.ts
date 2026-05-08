import type { JobCalculation, LineItem, RateConfig } from "@/features/business/types/business";

/**
 * Formats a number as NZD currency string.
 * @param amount - Amount in dollars
 * @returns Formatted currency string (e.g. "$1,234.56")
 */
export function formatNZD(amount: number): string {
  return "$" + amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formats a Date or ISO string as NZ short date (DD/MM/YYYY).
 * @param date - Date object or ISO string
 * @returns Formatted date string (e.g. "01/05/2026")
 */
export function formatNZDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
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
 * Formats a Date as DD/MM/YYYY using UTC date parts (safe for server-side use).
 * @param date - The date to format
 * @returns Formatted date string
 */
export function formatUTCDDMMYYYY(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const y = date.getUTCFullYear();
  return `${d}/${m}/${y}`;
}

/**
 * Calculates invoice totals including optional GST.
 * @param lineItems - Array of line items with qty and unit price
 * @param gst - Whether to apply 15% GST
 * @returns Subtotal, GST amount, and total
 */
export function calcInvoiceTotals(
  lineItems: { qty: number; unitPrice: number }[],
  gst: boolean,
): { subtotal: number; gstAmount: number; total: number } {
  const subtotal = lineItems.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
  const gstAmount = gst ? Math.round(subtotal * 0.15 * 100) / 100 : 0;
  return { subtotal, gstAmount, total: subtotal + gstAmount };
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

/**
 * Calculates the complete cost breakdown for a job.
 * @param job - Job calculation with time, tasks, and parts
 * @returns Cost breakdown with time charge, tasks, parts, subtotal, GST, and total
 */
export function calcJobTotal(job: JobCalculation): {
  timeCharge: number;
  tasksTotal: number;
  partsTotal: number;
  travelTotal: number;
  subtotal: number;
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
  const subtotal = Math.round((timeCharge + tasksTotal + partsTotal + travelTotal) * 100) / 100;
  const gstAmount = job.gst ? Math.round(subtotal * 0.15 * 100) / 100 : 0;
  return {
    timeCharge,
    tasksTotal,
    partsTotal,
    travelTotal,
    subtotal,
    gstAmount,
    total: subtotal + gstAmount,
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
