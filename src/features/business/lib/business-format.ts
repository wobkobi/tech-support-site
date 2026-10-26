// src/features/business/lib/business-format.ts
// Display helpers for money, durations and dates on the calculator, invoice and admin
// views. Re-exported through business.ts.

import type { PromoRateSummary } from "@/features/business/types/business";
import { formatDateShort } from "@/shared/lib/date-format";
import { roundCents } from "@/shared/lib/money";
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
 * Formats billed time for an invoice's quantity column ("2 hr 20 min", "45 min", "1 hr").
 * Spelled out because customers read h:mm "1:55" as 1.55 hours.
 * @param mins - Billed minutes.
 * @returns The time in hours and minutes.
 */
export function formatBilledTime(mins: number): string {
  const whole = Math.max(0, Math.round(mins));
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/**
 * Quantity column text for one invoice line: hours and minutes for hourly labour, else the
 * plain count.
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
 * The line under an invoice's promo row, e.g. "1 hr 55 min at $65/hr instead of $100/hr",
 * so the customer can check the discount against the hours.
 * @param rate - The rate pair the promo billed at, or null when the lines had no single pair.
 * @returns The note, or null when there's no single rate to name.
 */
export function promoRateNote(rate: PromoRateSummary | null): string | null {
  if (!rate || rate.mins <= 0 || rate.after >= rate.before) return null;
  return `${formatBilledTime(rate.mins)} at ${formatMoneyCompact(rate.after)}/hr instead of ${formatMoneyCompact(rate.before)}/hr`;
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

/** Totals-block label for the discount on work that couldn't be fixed. */
export const UNSUCCESSFUL_LINE_LABEL = "Discount for work that couldn't be fixed";

/**
 * The line under an invoice's couldn't-fix row, so the customer can check the discount:
 * "Couldn't be fixed: Laptop repair, so $25.00 of labour is half price." The colon form
 * reads right for verb-phrase lines too ("Install Office").
 * @param tasks - The lines that couldn't be fixed; empty when the whole visit couldn't.
 * @param base - Labour the discount came off, after any promo and Gold Card.
 * @param factor - Share of that labour still charged (0.5 = half).
 * @returns The note, or null when there's no labour to name.
 */
export function unsuccessfulNote(tasks: string[], base: number, factor: number): string | null {
  if (!(base > 0)) return null;
  const names = [...new Set(tasks.map((t) => t.trim()).filter(Boolean))];
  const subject =
    names.length === 0
      ? "The problem couldn't be fixed"
      : names.length === 1
        ? `Couldn't be fixed: ${names[0]}`
        : `Couldn't be fixed: ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const share =
    factor <= 0
      ? "isn't charged"
      : factor === 0.5
        ? "is half price"
        : `is charged at ${Math.round(factor * 100)}%`;
  return `${subject}, so ${formatNZD(base)} of labour ${share}.`;
}

/** The invoice fields that say what's been paid. */
interface SettlementSource {
  status: string;
  total: number;
  alreadyPaid?: number | null;
  paidAt?: Date | string | null;
  voidedAt?: Date | string | null;
}

/** One totals row under Total. */
export interface SettlementRow {
  label: string;
  value: string;
  /** The closing Balance due row, drawn like Total. */
  bold?: boolean;
}

/**
 * The rows under Total that show what's been paid: money handed over on the day, then the
 * payment that cleared a paid invoice, then a Balance due that reads $0.00 once paid.
 * @param invoice - The invoice's status and payment fields.
 * @returns The rows, or empty when nothing has been paid (Total is then what's owed).
 */
export function settlementRows(invoice: SettlementSource): SettlementRow[] {
  if (invoice.status === "VOIDED") return [];
  const already = invoice.alreadyPaid && invoice.alreadyPaid > 0 ? invoice.alreadyPaid : 0;
  const paid = invoice.status === "PAID";
  if (!paid && already === 0) return [];
  const balance = Math.max(0, roundCents(invoice.total - already));
  const rows: SettlementRow[] = [];
  if (already > 0) rows.push({ label: "Already paid", value: `-${formatNZD(already)}` });
  if (paid && balance > 0) {
    const label = invoice.paidAt ? `Paid ${formatDateShort(invoice.paidAt)}` : "Paid";
    rows.push({ label, value: `-${formatNZD(balance)}` });
  }
  rows.push({ label: "Balance due", value: formatNZD(paid ? 0 : balance), bold: true });
  return rows;
}

/**
 * The box that takes the bank details' place once nothing is owed.
 * @param invoice - The invoice's status and dates.
 * @returns Heading and line, or null while the invoice still asks for payment.
 */
export function settledCallout(
  invoice: SettlementSource,
): { heading: string; text: string } | null {
  if (invoice.status === "PAID") {
    return {
      heading: "Paid, thank you",
      text: invoice.paidAt
        ? `Paid in full on ${formatDateShort(invoice.paidAt)}. There's nothing more to pay.`
        : "Paid in full. There's nothing more to pay.",
    };
  }
  if (invoice.status === "VOIDED") {
    return {
      heading: "Voided",
      text: invoice.voidedAt
        ? `This invoice was voided on ${formatDateShort(invoice.voidedAt)}, so there's nothing to pay.`
        : "This invoice has been voided, so there's nothing to pay.",
    };
  }
  return null;
}
