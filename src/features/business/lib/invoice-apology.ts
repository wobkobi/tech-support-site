// src/features/business/lib/invoice-apology.ts
// Decides whether an overdue reminder chased a bill the client had already
// paid. Pure and isomorphic on purpose: the payment dialog needs it to show the
// apology tick-box as the operator changes the payment date, and POST /pay
// re-checks it server-side before anything is emailed.

import { nzDateKey } from "@/shared/lib/timezone-utils";

/** The invoice fields the wrongly-chased check reads. */
export interface ApologyCheckInput {
  /** When the most recent overdue reminder was emailed; null = never chased. */
  reminderLastSentAt?: string | Date | null;
  /** When the payment actually landed - a "YYYY-MM-DD" date input value or an instant. */
  paidAt?: string | Date | null;
  /** When an apology already went out for this invoice; null = never. */
  apologySentAt?: string | Date | null;
}

/**
 * Whether a reminder went out on a later NZ calendar day than the payment
 * landed - i.e. the client was chased for money they had already sent.
 *
 * Compared by NZ calendar day rather than by instant for two reasons: the
 * payment date arrives as a bare "YYYY-MM-DD" with no time of day, and a
 * reminder that crosses a same-day bank transfer needs no apology (the reminder
 * copy already tells the client to ignore it in that case). The keys are
 * zero-padded YYYY-MM-DD, so a plain string comparison orders them correctly.
 * @param input - Reminder, payment, and prior-apology stamps.
 * @returns True when an apology is warranted and none has been sent yet.
 */
export function reminderChasedPaidInvoice(input: ApologyCheckInput): boolean {
  if (input.apologySentAt) return false;
  if (!input.reminderLastSentAt || !input.paidAt) return false;

  const reminded = new Date(input.reminderLastSentAt);
  const paid = new Date(input.paidAt);
  if (Number.isNaN(reminded.getTime()) || Number.isNaN(paid.getTime())) return false;

  return nzDateKey(reminded) > nzDateKey(paid);
}
