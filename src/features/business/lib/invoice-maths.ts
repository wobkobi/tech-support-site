// src/features/business/lib/invoice-maths.ts
// GST, invoice totals, line-item validation, numbering and subscription due dates.
// Re-exported through business.ts.

import { minsToHoursLabel } from "@/features/business/lib/business-format";
import { GST_RATE, GST_REGISTERED } from "@/features/business/lib/pricing-policy";
import type { JobCalculation, LineItem } from "@/features/business/types/business";
import { formatDateSlash } from "@/shared/lib/date-format";
import { roundCents, toCents } from "@/shared/lib/money";

/**
 * Extracts GST from a GST-inclusive amount.
 * @param amountIncl - Amount including GST
 * @param gstRate - GST rate as a decimal (e.g. 0.15)
 * @returns GST component, rounded to 2 decimal places
 */
export function calcGstFromInclusive(amountIncl: number, gstRate: number): number {
  return roundCents((amountIncl * gstRate) / (1 + gstRate));
}

/** The fields {@link splitLineTotals} prices a line from. */
export interface LineAmountInput {
  qty: number;
  unitPrice: number;
  /** Billed minutes on a timed (hourly) line; null on flat, part and travel lines. */
  minutes?: number | null;
  /** Line text, which settles who takes a leftover cent between otherwise equal lines. */
  description?: string;
  /** Second tie-break after the text, for lines that read the same but price differently. */
  tieKey?: string;
}

/**
 * Orders two tie-break strings by code unit, so the result never depends on locale.
 * @param a - First key.
 * @param b - Second key.
 * @returns Negative when `a` comes first, positive when `b` does, 0 when equal.
 */
function compareKeys(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Line totals in dollars, rounded so each rate's timed lines add up to that rate's whole
 * time billed at once (35+35+20 min at $100/hr = $58.34 + $58.33 + $33.33 = $150.00).
 *
 * Timed lines group by unit price: each takes its floored cents, then leftover cents go to
 * the largest fractions, ties to the bigger line, then by description and tieKey, and only
 * then the earlier line. Settling ties by content keeps a discount read off one line (a
 * "Didn't finish" half, business labour) the same whatever order the lines were typed in.
 * Untimed lines round qty x unitPrice alone. Saved invoices re-total from these fields.
 * @param lines - Line items or task lines, in display order.
 * @returns Each line's total in dollars, in the same order.
 */
export function splitLineTotals(lines: readonly LineAmountInput[]): number[] {
  const cents = lines.map((l) => toCents(l.qty * l.unitPrice));
  const byRate = new Map<number, number[]>();
  lines.forEach((l, i) => {
    if (l.minutes == null) return;
    byRate.set(l.unitPrice, [...(byRate.get(l.unitPrice) ?? []), i]);
  });
  for (const [rate, idx] of byRate) {
    const exact = idx.map((i) => (lines[i]!.minutes! * rate * 100) / 60);
    const totalMins = idx.reduce((s, i) => s + lines[i]!.minutes!, 0);
    const target = toCents((totalMins * rate) / 60);
    // The epsilon keeps float noise (5833.9999999) from flooring a whole cent away.
    const floors = exact.map((x) => Math.floor(x + 1e-9));
    let leftover = target - floors.reduce((s, x) => s + x, 0);
    // Fractions within float noise are a tie (.33333333333348 vs .333333333333), so the
    // tie-break decides: bigger line, then its text and tieKey, then earlier.
    const fraction = exact.map((x, k) => x - floors[k]!);
    /**
     * The line at a position within this rate's group.
     * @param k - Position in `idx`.
     * @returns The line it points at.
     */
    const line = (k: number): LineAmountInput => lines[idx[k]!]!;
    const order = idx
      .map((_, k) => k)
      .sort((a, b) => {
        const d = fraction[b]! - fraction[a]!;
        if (Math.abs(d) > 1e-6) return d;
        return (
          exact[b]! - exact[a]! ||
          compareKeys(line(a).description ?? "", line(b).description ?? "") ||
          compareKeys(line(a).tieKey ?? "", line(b).tieKey ?? "") ||
          a - b
        );
      });
    for (const k of order) {
      if (leftover <= 0) break;
      floors[k] = floors[k]! + 1;
      leftover--;
    }
    idx.forEach((i, k) => {
      cents[i] = floors[k]!;
    });
  }
  return cents.map((c) => c / 100);
}

/**
 * The items with every `lineTotal` re-derived by {@link splitLineTotals}, so the Total
 * column adds up to the subtotal. Run before storing or rendering.
 * @param items - Line items in display order.
 * @returns The items with their split line totals.
 */
export function withSplitLineTotals<T extends LineAmountInput>(
  items: readonly T[],
): (T & { lineTotal: number })[] {
  const totals = splitLineTotals(items);
  return items.map((item, i) => ({ ...item, lineTotal: totals[i]! }));
}

/**
 * Splits a GST-inclusive amount into its GST component and GST-exclusive base, derived
 * together so the pair can't drift apart.
 * @param amountIncl - Amount including GST.
 * @param gstRate - GST rate as a decimal (e.g. 0.15).
 * @returns GST component and exclusive base, each rounded to 2 decimal places.
 */
export function splitGstInclusive(
  amountIncl: number,
  gstRate: number,
): { gstAmount: number; amountExcl: number } {
  const gstAmount = calcGstFromInclusive(amountIncl, gstRate);
  return { gstAmount, amountExcl: roundCents(amountIncl - gstAmount) };
}

/**
 * Invoice totals with an optional discount. When {@link GST_REGISTERED}, GST is backed out of
 * the inclusive total via {@link calcGstFromInclusive}; discount comes off before GST (IRD).
 * @param lineItems - Array of line items with qty and unit price.
 * @param promoDiscount - Optional dollar discount (e.g. from a promo snapshot).
 * @param gstRegistered - Live GST-registration flag (defaults to the constant).
 * @returns Subtotal (gross), GST amount, and total (post-discount, post-GST).
 */
export function calcInvoiceTotals(
  lineItems: readonly LineAmountInput[],
  promoDiscount = 0,
  gstRegistered: boolean = GST_REGISTERED,
): { subtotal: number; gstAmount: number; total: number } {
  // Sum the same per-line cents the PDF prints, so the Total column matches the Subtotal.
  const subtotal = roundCents(splitLineTotals(lineItems).reduce((sum, line) => sum + line, 0));
  const taxableAmount = Math.max(0, roundCents(subtotal - promoDiscount));
  const gstAmount = gstRegistered ? calcGstFromInclusive(taxableAmount, GST_RATE) : 0;
  return {
    subtotal,
    gstAmount,
    total: taxableAmount,
  };
}

/**
 * The fields that set a line's price, so a description-only edit isn't read as a re-price.
 * @param lines - Invoice lines.
 * @returns A comparable key.
 */
export function pricedLinesKey(
  lines: readonly { qty: number; unitPrice: number; minutes?: number | null }[],
): string {
  return JSON.stringify(lines.map((l) => [l.qty, l.unitPrice, l.minutes ?? null]));
}

/**
 * What the client still owes after money paid on the day - the figure the invoice asks for
 * and payments match against. The invoice total stays the full job price.
 * @param invoice - Invoice total and the amount already paid, if any.
 * @param invoice.total - Full invoice total.
 * @param invoice.alreadyPaid - Amount paid before the invoice went out, or null.
 * @returns The balance, never below 0, rounded to cents.
 */
export function balanceDue(invoice: { total: number; alreadyPaid?: number | null }): number {
  const paid = invoice.alreadyPaid ?? 0;
  return Math.max(0, roundCents(invoice.total - paid));
}

/**
 * Every key a persisted line item may carry. Must match the Prisma `LineItem` composite
 * exactly: an undeclared key makes Prisma 500, so reject it here as a 400.
 */
const LINE_ITEM_FIELDS = new Set(["description", "qty", "unitPrice", "lineTotal", "minutes"]);

/**
 * Validates one untrusted line item before {@link calcInvoiceTotals} or the database.
 * @param item - Candidate line item from a request body.
 * @returns True when it has only {@link LINE_ITEM_FIELDS}, a description and finite numbers.
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
 * The sequence at the end of an invoice or quote number ("TTP-202627-0042" > 42).
 * @param number - A saved number, or null when there's none.
 * @returns The sequence, or 0 when there's no number or no trailing digits.
 */
export function numberSequence(number: string | null | undefined): number {
  const match = number?.match(/-(\d+)$/);
  return match ? parseInt(match[1] ?? "", 10) : 0;
}

/**
 * Next number in a financial year's run, e.g. TTP-202627-0098. Each 1 April starts again at
 * 0001, so only this year's numbers count. The sheet's counter (SETTINGS!B19, or B12 for
 * quotes) still holds last year's final count until this year's first number is written
 * back, so it only counts once this year has a number of its own.
 * @param prefix - "TTP" for invoices, "Q" for quotes.
 * @param yearCode - Financial year code ("202627").
 * @param dbLast - Highest sequence already saved this year; 0 when none.
 * @param sheetLast - The sheet counter's last issued number; null when the sheet wasn't read.
 * @returns The formatted number and its sequence, for the counter write-back.
 */
export function nextInvoiceNumber(
  prefix: string,
  yearCode: string,
  dbLast: number,
  sheetLast: number | null,
): { number: string; sequence: number } {
  const sequence = Math.max(dbLast, dbLast > 0 ? (sheetLast ?? 0) : 0) + 1;
  return { number: `${prefix}-${yearCode}-${String(sequence).padStart(4, "0")}`, sequence };
}

/**
 * Advances a subscription's next due date by its frequency, in UTC to dodge DST. Month
 * steps clamp to the month's last day (31 Jan monthly > 28/29 Feb, not 3 Mar).
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
 * Adds whole months to `d` in UTC (mutating it), clamping the day to the target month's end.
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
