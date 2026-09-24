// Display helpers for money, durations and dates on the calculator, invoice and admin
// views. Re-exported through business.ts.

import { nzTodayKey } from "@/shared/lib/timezone-utils";

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
