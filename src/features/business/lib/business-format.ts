// src/features/business/lib/business-format.ts
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
 * Money for customer-facing prose: "$65" or "$7.50", unlike {@link formatNZD}'s "$65.00".
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
 * Today as YYYY-MM-DD in Pacific/Auckland; UTC would show yesterday every NZ morning.
 * @returns ISO date string for today in NZ.
 */
export function todayISO(): string {
  return nzTodayKey();
}

/**
 * Formats billed time for an invoice's quantity column as h:mm ("2:20", "0:45"), so the
 * column visibly sums to the session length.
 * @param mins - Billed minutes.
 * @returns h:mm string.
 */
export function formatBilledTime(mins: number): string {
  const whole = Math.max(0, Math.round(mins));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Quantity column text for one invoice line: h:mm for hourly labour, else the plain count.
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
 * Composes the line-item description from device + action + optional details, shared by
 * AI-generated and operator-entered tasks.
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
 * Whether one comma item of a task's details only restates its device/action tags, as in
 * "Printer setup - new printer". "New" counts only on a Setup line; "new Canon printer" stays.
 * @param item - One trimmed comma item from details.
 * @param device - The line's device tag.
 * @param action - The line's action tag.
 * @returns True when the item adds nothing the description doesn't already say.
 */
export function restatesTaskLine(
  item: string,
  device: string | null | undefined,
  action: string | null | undefined,
): boolean {
  if (!device || !action) return false;
  const words = item.toLowerCase().replace(/\s+/g, " ").trim();
  const setup = action.toLowerCase() === "setup";
  const rest = setup ? words.replace(/^(?:brand )?new\b ?/, "") : words;
  if (!rest) return rest !== words;
  const d = device.toLowerCase();
  const a = action.toLowerCase();
  return [d, a, `${d} ${a}`].some((s) => rest === s || rest === `${s}s`);
}

/**
 * Totals-block label for an invoice's promo line, shared by the PDF, preview and invoice
 * page. No "labour only" suffix, since a Free travel promo comes off travel.
 * @param title - The promo's title, when the invoice kept one.
 * @returns The label text.
 */
export function promoLineLabel(title: string | null | undefined): string {
  return title ? `Promo: ${title}` : "Promo discount";
}

/**
 * A Gold Card share as "10% off labour", for its tick boxes and invoice line.
 * @param percent - The share taken off labour (0.1 = 10%).
 * @returns The text, one decimal at most: 12.5% stays 12.5%, 10% doesn't print as 10.0%.
 */
export function goldCardOffText(percent: number): string {
  return `${Number((percent * 100).toFixed(1))}% off labour`;
}

/**
 * Totals-block label for an invoice's Gold Card line, shared by the PDF, preview, invoice
 * page and quick price.
 * @param percent - The share taken off labour (0.1 = 10%), when the invoice kept it.
 * @returns The label text, e.g. "Gold Card discount (10% off labour)".
 */
export function goldCardLineLabel(percent: number | null | undefined): string {
  return `Gold Card discount (${percent ? goldCardOffText(percent) : "labour only"})`;
}
