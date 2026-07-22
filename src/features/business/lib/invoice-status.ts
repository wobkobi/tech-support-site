// src/features/business/lib/invoice-status.ts
/**
 * @description Single source of truth for the derived OVERDUE state of an
 * invoice. An invoice is overdue when it is SENT and its due date is before the
 * start of today. The PDF watermark, the list badges, and the reminder cron all
 * read from here so the definition can't drift.
 *
 * Timezone note: today is computed in the runtime's local zone. On Vercel that
 * is UTC, whereas a browser renders in NZ - so "overdue" can flip up to ~13h
 * earlier server-side than a NZ operator would reckon. This divergence is
 * accepted (it matches the existing PDF watermark behaviour) rather than pulling
 * a timezone dependency into this pure, isomorphic helper.
 */

import type { InvoiceStatus } from "@/features/business/types/business";

/** The minimal invoice shape the overdue check needs. */
export interface OverdueCheckInput {
  /** Stored invoice status. */
  status: InvoiceStatus;
  /** Due date as an ISO string or a Date. */
  dueDate: string | Date;
  /** True when the row is a quote; null/undefined reads as false. */
  isQuote?: boolean | null;
  /** Quote validity end; past it the quote displays as EXPIRED. */
  quoteValidUntil?: string | Date | null;
}

/** What the admin UI shows on the pill: a stored status or a derived one. */
export type InvoiceDisplayStatus = InvoiceStatus | "OVERDUE" | "QUOTE" | "EXPIRED";

/**
 * Prisma where-fragment excluding quote rows. MUST be this OR shape: on the
 * Mongo connector, `NOT: { isQuote: true }` and `isQuote: { not: true }` both
 * fail to match documents where the field is UNSET (every invoice created
 * before the quote feature), silently dropping legacy invoices. Spread into a
 * `where` that has no OR of its own (wrap in AND otherwise).
 */
export const NOT_A_QUOTE_FILTER = {
  // Plain mutable shape (no `as const`): Prisma's InvoiceWhereInput requires
  // a mutable OR array.
  OR: [{ isQuote: null }, { isQuote: false }, { isQuote: { isSet: false } }],
};

/**
 * Whether an invoice is overdue: SENT with a due date before the start of
 * `now`'s day. Quotes are never overdue - their dueDate is a schema
 * placeholder, not a payment deadline.
 * @param invoice - Invoice status + due date.
 * @param now - Reference instant (defaults to the current time).
 * @returns True when the invoice is SENT and past due.
 */
export function isInvoiceOverdue(invoice: OverdueCheckInput, now: Date = new Date()): boolean {
  if (invoice.isQuote) return false;
  if (invoice.status !== "SENT") return false;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return new Date(invoice.dueDate) < startOfToday;
}

/**
 * The status to DISPLAY for an invoice: the stored status, except a SENT
 * invoice past due surfaces as "OVERDUE", and a quote surfaces as "QUOTE"
 * (or "EXPIRED" once its validity date passes). A voided quote still shows
 * VOIDED - terminal states win.
 * @param invoice - Invoice status + due date (+ quote fields).
 * @param now - Reference instant (defaults to the current time).
 * @returns The display status.
 */
export function deriveInvoiceDisplayStatus(
  invoice: OverdueCheckInput,
  now: Date = new Date(),
): InvoiceDisplayStatus {
  if (invoice.isQuote && invoice.status !== "VOIDED") {
    return invoice.quoteValidUntil && new Date(invoice.quoteValidUntil) < now ? "EXPIRED" : "QUOTE";
  }
  return isInvoiceOverdue(invoice, now) ? "OVERDUE" : invoice.status;
}
