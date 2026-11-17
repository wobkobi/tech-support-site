// src/features/business/lib/invoice-payment-match.ts
// Finds an income entry that looks like a still-SENT invoice's payment, since money typed
// into the Cashbook sheet never links to it. Stops reminders chasing someone who has paid.

import { formatNZD } from "@/features/business/lib/business-format";
import { balanceIncomeWhere } from "@/features/business/lib/invoice-already-paid";
import { balanceDue } from "@/features/business/lib/invoice-maths";
import { formatDateShort } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";
import { nzDayStartUtc } from "@/shared/lib/timezone-utils";

/** Cents of slack on the amount compare: the sheet round-trips it through a float. */
const AMOUNT_TOLERANCE = 0.01;

/**
 * Days before the issue date a loose match may fall: a bank transfer made on the day of the
 * job can land before an invoice dated the next day.
 */
export const LOOSE_MATCH_EARLY_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Words that say nothing about who paid, so they never count as a shared name. */
const NON_NAME_TOKENS = new Set(["and", "ltd", "limited", "the", "mr", "mrs", "ms", "dr", "nz"]);

/**
 * How sure the match is. "linked" is proof (only the pay route writes invoiceId); "likely"
 * has the customer's full name; "possible" only shares a first or last name, so the owner
 * must check it.
 */
export type PaymentMatchStrength = "linked" | "likely" | "possible";

/** An income entry that appears to settle an invoice. */
export interface PaymentMatch {
  entryId: string;
  date: Date;
  amount: number;
  method: string;
  /** The Cashbook's customer name, e.g. "Carol" for Carol Bearsley. */
  customer: string;
  strength: PaymentMatchStrength;
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

/** The income entry fields {@link pickPaymentEntry} reads. */
export interface PaymentEntryCandidate {
  id: string;
  date: Date;
  amount: number;
  method: string;
  customer: string;
}

/**
 * Normalises case, macrons, spacing and punctuation so hand-typed names compare ("Hēmi"
 * matches "Hemi").
 * @param name - Raw customer or client name.
 * @returns Comparable form.
 */
export function normaliseCustomerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The name words that can identify a payer: two letters or more, minus "and", "Ltd" and
 * titles ("Joan & John Martin" gives joan, john, martin).
 * @param name - Raw customer or client name.
 * @returns Normalised name tokens.
 */
export function nameTokens(name: string): string[] {
  return normaliseCustomerName(name)
    .split(" ")
    .filter((t) => t.length >= 2 && !NON_NAME_TOKENS.has(t));
}

/**
 * Whether two names share a first or last name ("Carol" and "Carol Bearsley").
 * @param a - One name.
 * @param b - The other.
 * @returns True when any name token is in both.
 */
export function sharesNameToken(a: string, b: string): boolean {
  const tokens = new Set(nameTokens(a));
  return nameTokens(b).some((t) => tokens.has(t));
}

/**
 * Picks the payment among unlinked entries already filtered to the amount owing. An exact
 * full name on or after the issue day wins ("likely"); otherwise the earliest entry sharing
 * a name token, up to {@link LOOSE_MATCH_EARLY_DAYS} before it ("possible").
 * @param clientName - Invoice.clientName.
 * @param issueDay - UTC midnight of the invoice's NZ issue date (ledger rows sit there).
 * @param entries - Candidate entries, earliest first.
 * @returns The entry and how sure the match is, or null.
 */
export function pickPaymentEntry<E extends PaymentEntryCandidate>(
  clientName: string,
  issueDay: Date,
  entries: E[],
): { entry: E; strength: "likely" | "possible" } | null {
  const wanted = normaliseCustomerName(clientName);
  const exact = entries.find(
    (e) => e.date >= issueDay && normaliseCustomerName(e.customer) === wanted,
  );
  if (exact) return { entry: exact, strength: "likely" };
  const earliest = new Date(issueDay.getTime() - LOOSE_MATCH_EARLY_DAYS * DAY_MS);
  const loose = entries.find((e) => e.date >= earliest && sharesNameToken(e.customer, clientName));
  return loose ? { entry: loose, strength: "possible" } : null;
}

/** The owner push for an overdue reminder held back by a payment (or nothing owing). */
export interface HeldReminderPush {
  title: string;
  body: string;
  url: string;
  tag: string;
}

/**
 * The push telling the owner a reminder was held and the invoice needs marking paid. One
 * tag per invoice, so the daily cron replaces it rather than stacking.
 * @param invoice - The held invoice.
 * @param invoice.id - Invoice id, for the link and tag.
 * @param invoice.number - Invoice number.
 * @param invoice.clientName - Who it's for.
 * @param match - The payment found, or null when nothing is left owing.
 * @returns Push content for sendOwnerPush.
 */
export function heldReminderPush(
  invoice: { id: string; number: string; clientName: string },
  match: Pick<PaymentMatch, "amount" | "date" | "customer" | "strength"> | null,
): HeldReminderPush {
  const who = invoice.clientName.trim() || "the client";
  const base = { url: `/admin/business/invoices/${invoice.id}`, tag: `invoice-paid:${invoice.id}` };
  if (!match) {
    return {
      ...base,
      title: `${invoice.number} has nothing left owing`,
      body: `No reminder sent to ${who}. Mark the invoice paid.`,
    };
  }
  const paid = `${formatNZD(match.amount)} on ${formatDateShort(match.date)}`;
  if (match.strength === "possible") {
    return {
      ...base,
      title: `Check a payment for ${invoice.number}`,
      body: `"${match.customer}" paid ${paid}, the amount ${who} owes. No reminder sent. If it's theirs, mark the invoice paid.`,
    };
  }
  return {
    ...base,
    title: `${invoice.number} looks paid`,
    body: `${who} paid ${paid}. No reminder sent. Mark the invoice paid.`,
  };
}

/**
 * Looks for a recorded payment: the linked entry, else an unlinked one for the balance due
 * with the customer's name (see {@link pickPaymentEntry}).
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
      customer: linked.customer,
      strength: "linked",
    };
  }

  const owed = balanceDue(invoice);
  // Floor to the NZ day: ledger rows sit at UTC midnight but issueDate carries a time.
  const issueDay = nzDayStartUtc(invoice.issueDate);
  const candidates = await prisma.incomeEntry.findMany({
    where: {
      // Sheet-imported rows lack the key, and `invoiceId: null` on Mongo means "exists AND
      // is null", so the OR catches both shapes.
      OR: [{ invoiceId: null }, { invoiceId: { isSet: false } }],
      date: { gte: new Date(issueDay.getTime() - LOOSE_MATCH_EARLY_DAYS * DAY_MS) },
      amount: { gte: owed - AMOUNT_TOLERANCE, lte: owed + AMOUNT_TOLERANCE },
    },
    orderBy: { date: "asc" },
  });

  const match = pickPaymentEntry(invoice.clientName, issueDay, candidates);
  if (!match) return null;
  const { entry } = match;
  return {
    entryId: entry.id,
    date: entry.date,
    amount: entry.amount,
    method: entry.method,
    customer: entry.customer,
    strength: match.strength,
  };
}
