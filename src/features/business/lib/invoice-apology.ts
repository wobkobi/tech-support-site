// src/features/business/lib/invoice-apology.ts
// Whether an overdue reminder chased a bill already paid. Isomorphic: the payment dialog
// and POST /pay both run it.

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
 * Whether a reminder went out on a later NZ day than the payment. By day, not instant: the
 * payment date has no time, and a same-day crossing needs no apology. Keys compare as strings.
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
