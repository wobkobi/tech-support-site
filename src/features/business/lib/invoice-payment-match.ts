// src/features/business/lib/invoice-payment-match.ts
// Finds the income entry that looks like an invoice's payment, for an invoice
// the site still has as SENT. Money entered straight into the Cashbook sheet
// never touches the invoice - only POST /pay links the two - so the row stays
// SENT and the reminder cron chases someone who has already paid. The cron uses
// this to hold off, and the invoice page uses it to prompt for the missing
// payment record.

import { prisma } from "@/shared/lib/prisma";
import { nzDayStartUtc } from "@/shared/lib/timezone-utils";

/** Cents of slack on the amount compare: the sheet round-trips it through a float. */
const AMOUNT_TOLERANCE = 0.01;

/** An income entry that appears to settle an invoice. */
export interface PaymentMatch {
  entryId: string;
  date: Date;
  amount: number;
  method: string;
  /**
   * How certain the match is. "linked" is proof - only the pay route writes
   * invoiceId. "likely" is the operator's own numbers lining up, and needs
   * confirming before anything irreversible happens.
   */
  strength: "linked" | "likely";
}

/** The invoice fields the match needs. */
export interface PaymentMatchInput {
  id: string;
  clientName: string;
  total: number;
  issueDate: Date;
}

/**
 * Reduces a name to something two hand-typed spellings can agree on: case,
 * surrounding space and punctuation all vary between the invoice and whatever
 * was typed into the sheet.
 * @param name - Raw customer or client name.
 * @returns Comparable form.
 */
function normaliseCustomerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Looks for a recorded payment against an unpaid invoice.
 *
 * Checks the linked entry first, then falls back to the pair the operator would
 * have typed into the sheet: this invoice's exact total, for the same customer,
 * dated on or after the issue date. Unlinked entries only, so a match can never
 * be another invoice's payment being counted twice.
 * @param invoice - The invoice being checked.
 * @returns The match, or null when nothing looks like a payment.
 */
export async function findRecordedPayment(
  invoice: PaymentMatchInput,
): Promise<PaymentMatch | null> {
  const linked = await prisma.incomeEntry.findFirst({ where: { invoiceId: invoice.id } });
  if (linked) {
    return {
      entryId: linked.id,
      date: linked.date,
      amount: linked.amount,
      method: linked.method,
      strength: "linked",
    };
  }

  const candidates = await prisma.incomeEntry.findMany({
    where: {
      // Sheet-imported rows have no invoiceId key at all, and Prisma compiles a
      // bare `invoiceId: null` to "exists AND is null" on Mongo - which skips
      // exactly the rows this is looking for. The OR catches both shapes.
      OR: [{ invoiceId: null }, { invoiceId: { isSet: false } }],
      // Floored to the issue date's NZ day, not the instant: ledger rows sit at
      // UTC midnight while issueDate carries a time, so an invoice raised at 3pm
      // and paid that evening matched nothing and got chased as overdue.
      date: { gte: nzDayStartUtc(invoice.issueDate) },
      amount: { gte: invoice.total - AMOUNT_TOLERANCE, lte: invoice.total + AMOUNT_TOLERANCE },
    },
    orderBy: { date: "asc" },
  });

  const wanted = normaliseCustomerName(invoice.clientName);
  const match = candidates.find((e) => normaliseCustomerName(e.customer) === wanted);
  if (!match) return null;

  return {
    entryId: match.id,
    date: match.date,
    amount: match.amount,
    method: match.method,
    strength: "likely",
  };
}
