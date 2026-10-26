// src/features/business/lib/invoice-status.ts
// Single source of truth for an invoice's derived OVERDUE / QUOTE / EXPIRED display state.
// Days are NZ calendar days on both server (UTC on Vercel) and browser, so the dashboard,
// the list and the PDF all flip to OVERDUE at NZ midnight.

import type { InvoiceStatus } from "@/features/business/types/business";
import { nzDateKey } from "@/shared/lib/timezone-utils";

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
 * Prisma where-fragment excluding quotes. MUST be this OR shape: on Mongo, `NOT` / `not`
 * skip rows where isQuote is unset. Spread only into a `where` without its own OR.
 */
export const NOT_A_QUOTE_FILTER = {
  // No `as const`: Prisma's InvoiceWhereInput needs a mutable OR array.
  OR: [{ isQuote: null }, { isQuote: false }, { isQuote: { isSet: false } }],
};

/**
 * Whether an invoice is SENT with a due date before `now`'s NZ day. Quotes never are;
 * their dueDate is a placeholder.
 * @param invoice - Invoice status + due date.
 * @param now - Reference instant (defaults to the current time).
 * @returns True when the invoice is SENT and past due.
 */
export function isInvoiceOverdue(invoice: OverdueCheckInput, now: Date = new Date()): boolean {
  if (invoice.isQuote) return false;
  if (invoice.status !== "SENT") return false;
  const due = new Date(invoice.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  // YYYY-MM-DD keys compare as text.
  return nzDateKey(due) < nzDateKey(now);
}

/**
 * The status to display: OVERDUE for a past-due SENT invoice, QUOTE or EXPIRED for a
 * live quote, else the stored status (a voided quote shows VOIDED).
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
