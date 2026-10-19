// src/features/business/lib/invoice-payment-match.ts
// Finds an income entry that looks like a still-SENT invoice's payment, since money typed
// into the Cashbook sheet never links to it. Stops reminders chasing someone who has paid.

import { balanceIncomeWhere } from "@/features/business/lib/invoice-already-paid";
import { balanceDue } from "@/features/business/lib/invoice-maths";
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
  /** "linked" is proof (only the pay route writes invoiceId); "likely" needs confirming. */
  strength: "linked" | "likely";
}

/** The invoice fields the match needs. */
export interface PaymentMatchInput {
  id: string;
  clientName: string;
  total: number;
  issueDate: Date;
  /** Money handed over before the invoice went out; the payment is the rest. */
  alreadyPaid?: number | null;
  /** The already-paid income entry, which is never the payment. */
  alreadyPaidIncomeId?: string | null;
}

/**
 * Normalises case, spacing and punctuation so hand-typed names compare.
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
 * Looks for a recorded payment: the linked entry, else an unlinked one for the balance due,
 * same customer, on or after the issue date.
 * @param invoice - The invoice being checked.
 * @returns The match, or null when nothing looks like a payment.
 */
export async function findRecordedPayment(
  invoice: PaymentMatchInput,
): Promise<PaymentMatch | null> {
  const linked = await prisma.incomeEntry.findFirst({ where: balanceIncomeWhere(invoice) });
  if (linked) {
    return {
      entryId: linked.id,
      date: linked.date,
      amount: linked.amount,
      method: linked.method,
      strength: "linked",
    };
  }

  const owed = balanceDue(invoice);
  const candidates = await prisma.incomeEntry.findMany({
    where: {
      // Sheet-imported rows lack the key, and `invoiceId: null` on Mongo means "exists AND
      // is null", so the OR catches both shapes.
      OR: [{ invoiceId: null }, { invoiceId: { isSet: false } }],
      // Floor to the NZ day: ledger rows sit at UTC midnight but issueDate carries a time.
      date: { gte: nzDayStartUtc(invoice.issueDate) },
      amount: { gte: owed - AMOUNT_TOLERANCE, lte: owed + AMOUNT_TOLERANCE },
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
