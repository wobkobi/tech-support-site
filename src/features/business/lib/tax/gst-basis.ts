// src/features/business/lib/tax/gst-basis.ts
// Which side of GST a row counts on for income tax: GST-inclusive before registration,
// GST-exclusive once registered.

import { GST_RATE } from "@/features/business/lib/pricing-policy";
import { ledgerDay, roundCents } from "@/features/business/lib/tax/helpers";
import type { GstStatus, LedgerIncome } from "@/features/business/lib/tax/types";

/**
 * Whether the business was GST registered on a given NZ day.
 * @param date - Row date (ISO ledger date or a real instant).
 * @param gst - Registration status; an empty or null `registeredFrom` means from business start.
 * @returns True when registered on that NZ day.
 */
export function isGstRegisteredOn(date: string | Date, gst: GstStatus): boolean {
  if (!gst.registered) return false;
  if (!gst.registeredFrom) return true;
  return ledgerDay(date).getTime() >= ledgerDay(gst.registeredFrom).getTime();
}

/**
 * The amount an expense row deducts before any business-use split.
 * @param expense - The row's date and both GST amounts.
 * @param expense.date - Row date.
 * @param expense.amountIncl - GST-inclusive amount.
 * @param expense.amountExcl - GST-exclusive amount.
 * @param gst - Registration status.
 * @returns `amountExcl` when registered on the row date, else `amountIncl`.
 */
export function expenseTaxBasis(
  expense: { date: string | Date; amountIncl: number; amountExcl: number },
  gst: GstStatus,
): number {
  return isGstRegisteredOn(expense.date, gst) ? expense.amountExcl : expense.amountIncl;
}

/**
 * The amount an income row counts as income. Rows store GST-inclusive amounts, so once
 * registered the GST at {@link GST_RATE} (3/23 at 15%) is backed out.
 * @param row - The income row.
 * @param gst - Registration status.
 * @returns `amount / (1 + GST_RATE)` to the cent when registered on the row date, else `amount`.
 */
export function incomeTaxBasis(row: LedgerIncome, gst: GstStatus): number {
  return isGstRegisteredOn(row.date, gst) ? roundCents(row.amount / (1 + GST_RATE)) : row.amount;
}

/**
 * GST status from the pricing settings; a blank "registered from" means from business start.
 * @param pricing - The two GST fields of the pricing settings.
 * @param pricing.gstRegistered - Whether the business is GST registered.
 * @param pricing.gstRegisteredFrom - "YYYY-MM-DD" registration took effect, or "".
 * @returns Status for {@link isGstRegisteredOn}.
 */
export function gstStatusFromPricing(pricing: {
  gstRegistered: boolean;
  gstRegisteredFrom: string;
}): GstStatus {
  const from = pricing.gstRegisteredFrom.trim();
  return { registered: pricing.gstRegistered, registeredFrom: from === "" ? null : from };
}

/**
 * Default GST rate for an expense on `date`: 0 before registration, else the registered rate.
 * @param date - Expense date.
 * @param gst - Registration status.
 * @param registeredRate - Rate once registered ({@link GST_RATE}).
 * @returns The rate as a fraction.
 */
export function expenseGstRateOn(
  date: string | Date,
  gst: GstStatus,
  registeredRate: number,
): number {
  return isGstRegisteredOn(date, gst) ? registeredRate : 0;
}
