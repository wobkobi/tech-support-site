// GST extraction, invoice totals and line-item validation, invoice numbering, subscription
// due dates and ledger income descriptions. Re-exported through business.ts.

import { minsToHoursLabel } from "@/features/business/lib/business-format";
import { GST_RATE, GST_REGISTERED } from "@/features/business/lib/pricing-policy";
import type { JobCalculation, LineItem } from "@/features/business/types/business";
import { formatDateSlash } from "@/shared/lib/date-format";

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
  const next = parseInt(match[1] ?? "", 10) + 1;
  return `${prefix}-${yearCode}-${String(next).padStart(4, "0")}`;
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
