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
}

/**
 * Whether an invoice is overdue: SENT with a due date before the start of
 * `now`'s day.
 * @param invoice - Invoice status + due date.
 * @param now - Reference instant (defaults to the current time).
 * @returns True when the invoice is SENT and past due.
 */
export function isInvoiceOverdue(invoice: OverdueCheckInput, now: Date = new Date()): boolean {
  if (invoice.status !== "SENT") return false;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return new Date(invoice.dueDate) < startOfToday;
}

/**
 * The status to DISPLAY for an invoice: the stored status, except a SENT invoice
 * past due surfaces as "OVERDUE". PAID / VOIDED / DRAFT pass through unchanged.
 * @param invoice - Invoice status + due date.
 * @param now - Reference instant (defaults to the current time).
 * @returns The display status (a stored status, or the derived "OVERDUE").
 */
export function deriveInvoiceDisplayStatus(
  invoice: OverdueCheckInput,
  now: Date = new Date(),
): InvoiceStatus | "OVERDUE" {
  return isInvoiceOverdue(invoice, now) ? "OVERDUE" : invoice.status;
}
