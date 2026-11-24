// src/features/business/lib/invoice-replacement.server.ts
// Which voided invoice a new one replaces, and which live invoice replaced a voided one.
// The link is one field, `replacesNumber` on the replacement; the voided side is looked up.

import { NOT_A_QUOTE_FILTER } from "@/features/business/lib/invoice-status";
import { prisma } from "@/shared/lib/prisma";

/** A live (not voided) invoice that replaced a voided one. */
export interface Replacement {
  id: string;
  number: string;
  shareToken: string | null;
  /** DRAFT, SENT or PAID; a draft still counts, so the refusal names it. */
  status: string;
}

/**
 * The live invoice whose `replacesNumber` names this voided one, or null.
 * @param voidedNumber - The voided invoice's number.
 * @returns The replacement's id, number, share token and status, or null when none is live.
 */
export async function findLiveReplacement(voidedNumber: string): Promise<Replacement | null> {
  return prisma.invoice.findFirst({
    where: { replacesNumber: voidedNumber, status: { not: "VOIDED" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, number: true, shareToken: true, status: true },
  });
}

/** Outcome of {@link resolveReplacedInvoice}. */
export type ReplacedInvoiceResult =
  { ok: true; number: string | null } | { ok: false; error: string; status: number };

/**
 * Works out which voided invoice a new invoice replaces.
 *
 * An explicit re-issue (`reissuedId`) must name a voided invoice that has no live replacement
 * yet, so the same job can't be re-billed twice from the voided page. Without one, a new
 * (non-quote) invoice billing the same booking or calendar event as a voided invoice that
 * nothing has replaced yet takes that link quietly: "Bill in calculator" on the event after a
 * void is the same re-issue by another route. The voided one must also be for the same customer
 * (contact, email or mobile), so an invoice voided because it named the wrong person is never
 * linked to the right person's bill.
 * @param args - What the new invoice bills.
 * @param args.reissuedId - The voided invoice explicitly being re-issued, or null.
 * @param args.isQuote - Quotes never replace an invoice.
 * @param args.bookingId - Booking the new invoice bills, or null.
 * @param args.calendarEventIds - Every calendar event the new invoice bills.
 * @param args.customer - Who the new invoice bills.
 * @param args.customer.contactId - Linked contact, or null.
 * @param args.customer.email - Billed email, normalised, or null.
 * @param args.customer.phone - Billed mobile in E.164, or null.
 * @returns The voided number to store as `replacesNumber` (null for none), or a refusal.
 */
export async function resolveReplacedInvoice(args: {
  reissuedId: string | null;
  isQuote: boolean;
  bookingId: string | null;
  calendarEventIds: string[];
  customer: { contactId: string | null; email: string | null; phone: string | null };
}): Promise<ReplacedInvoiceResult> {
  if (args.reissuedId) {
    const voided = await prisma.invoice.findFirst({
      where: { id: args.reissuedId, status: "VOIDED" },
      select: { number: true },
    });
    if (!voided) return { ok: true, number: null };
    const existing = await findLiveReplacement(voided.number);
    if (existing) {
      return {
        ok: false,
        error:
          existing.status === "DRAFT"
            ? `${voided.number} was already replaced by ${existing.number}, still a draft. Finish or delete that one first.`
            : `${voided.number} was already replaced by ${existing.number}.`,
        status: 409,
      };
    }
    return { ok: true, number: voided.number };
  }

  if (args.isQuote) return { ok: true, number: null };
  const or = [
    ...(args.bookingId ? [{ bookingId: args.bookingId }] : []),
    ...(args.calendarEventIds.length > 0
      ? [
          { calendarEventId: { in: args.calendarEventIds } },
          { calendarEventIds: { hasSome: args.calendarEventIds } },
        ]
      : []),
  ];
  const { contactId, email, phone } = args.customer;
  const sameCustomer = [
    ...(contactId ? [{ contactId }] : []),
    ...(email ? [{ clientEmail: { equals: email, mode: "insensitive" as const } }] : []),
    ...(phone ? [{ clientPhone: phone }] : []),
  ];
  if (or.length === 0 || sameCustomer.length === 0) return { ok: true, number: null };

  const candidates = await prisma.invoice.findMany({
    // AND, since each part is its own OR; the quote filter's OR shape also matches older rows
    // that have no isQuote field.
    where: { status: "VOIDED", AND: [NOT_A_QUOTE_FILTER, { OR: or }, { OR: sameCustomer }] },
    orderBy: { voidedAt: "desc" },
    select: { number: true },
    take: 5,
  });
  for (const c of candidates) {
    if (!(await findLiveReplacement(c.number))) return { ok: true, number: c.number };
  }
  return { ok: true, number: null };
}
