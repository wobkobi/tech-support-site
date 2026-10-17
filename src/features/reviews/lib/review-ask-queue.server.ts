// src/features/reviews/lib/review-ask-queue.server.ts
// Gathers every invoice whose review ask is still undecided, with the contact, opt-out
// and last-ask state the rules need, and runs decideReviewAsk on each. Read-only on
// purpose: the admin reviews page calls this on every render, and minting a review token
// writes the Contact, which re-pushes it to Google on the next sync. The job mints the
// token only after it has claimed an invoice. Also forecasts one invoice's ask for the
// send modal, with the same rules.

import { findInvoiceContact } from "@/features/business/lib/contact-review-token";
import { NOT_A_QUOTE_FILTER } from "@/features/business/lib/invoice-status";
import { contactReviewAskState } from "@/features/reviews/lib/review-ask-opt-out";
import {
  contactAddresses,
  decideReviewAsk,
  pickReviewAskAddress,
  reviewAskClockStart,
  reviewAskDueAt,
  type InvoiceReviewAskInfo,
  type ReviewAskDecision,
  type ReviewAskTiming,
} from "@/features/reviews/lib/review-ask-rules";
import { formatDateShort } from "@/shared/lib/date-format";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { prisma } from "@/shared/lib/prisma";
import type { ReviewAskOutcome } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A failed ask is retried by the next run until it has been attempted this many times. */
export const REVIEW_ASK_MAX_ATTEMPTS = 2;

/** The contact a review ask goes to. */
export interface ReviewAskContact {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  altEmails: string[];
  reviewToken: string | null;
}

/** One undecided invoice and what the job would do with it now. */
export interface ReviewAskCandidate {
  invoice: {
    id: string;
    number: string;
    clientName: string;
    clientEmail: string;
    status: string;
    clockStart: Date;
    outcome: ReviewAskOutcome | null;
    attempts: number;
  };
  contact: ReviewAskContact | null;
  address: string | null;
  decision: ReviewAskDecision;
}

const CONTACT_SELECT = {
  id: true,
  name: true,
  company: true,
  email: true,
  altEmails: true,
  reviewToken: true,
  reviewLinkSentAt: true,
} as const;

/**
 * Case-insensitive equality filters for a set of addresses. Contact emails and invoice
 * client emails written before normalisation can carry capitals, so a plain `in` would
 * miss them.
 * @param field - The string field to match.
 * @param addresses - Normalised addresses.
 * @returns One filter per address, for an OR.
 */
function insensitiveAny<F extends string>(
  field: F,
  addresses: string[],
): Array<Record<F, { equals: string; mode: "insensitive" }>> {
  return addresses.map(
    (a) =>
      ({ [field]: { equals: a, mode: "insensitive" } }) as Record<
        F,
        { equals: string; mode: "insensitive" }
      >,
  );
}

/**
 * Loads every invoice whose review ask is undecided (or failed with retries left) and
 * decides each one as of `now`. Ordered by invoice send time, the order the job acts in.
 * @param now - Current instant.
 * @param timing - Delay and gap from settings.
 * @param opts - Options.
 * @param opts.onlyInvoiceId - Restrict to one invoice (local testing, Send now). A
 *   failed ask is then included whatever its attempt count, so Send now can retry it.
 * @returns Candidates with their decisions.
 */
export async function loadReviewAskCandidates(
  now: Date,
  timing: ReviewAskTiming,
  opts: { onlyInvoiceId?: string } = {},
): Promise<ReviewAskCandidate[]> {
  // Two ORs, so NOT_A_QUOTE_FILTER (itself an OR) has to sit inside the AND.
  const invoices = await prisma.invoice.findMany({
    where: {
      ...(opts.onlyInvoiceId ? { id: opts.onlyInvoiceId } : {}),
      status: { in: ["SENT", "PAID", "VOIDED"] },
      AND: [
        NOT_A_QUOTE_FILTER,
        {
          OR: [
            { reviewAskOutcome: null },
            { reviewAskOutcome: { isSet: false } },
            opts.onlyInvoiceId
              ? { reviewAskOutcome: "failed" }
              : { reviewAskOutcome: "failed", reviewAskAttempts: { lt: REVIEW_ASK_MAX_ATTEMPTS } },
          ],
        },
        { OR: [{ sentAt: { not: null } }, { paidAt: { not: null } }] },
      ],
    },
    orderBy: [{ sentAt: "asc" }, { paidAt: "asc" }],
    select: {
      id: true,
      number: true,
      clientName: true,
      clientEmail: true,
      contactId: true,
      status: true,
      sentAt: true,
      paidAt: true,
      reviewAskOutcome: true,
      reviewAskAttempts: true,
    },
  });
  if (invoices.length === 0) return [];

  // Contacts, by the invoice's contactId or by its address
  const contactIds = [
    ...new Set(invoices.map((i) => i.contactId).filter((id): id is string => !!id)),
  ];
  const invoiceAddresses = [
    ...new Set(invoices.map((i) => normaliseEmail(i.clientEmail)).filter(Boolean)),
  ];
  const contacts = await prisma.contact.findMany({
    where: {
      deletedAt: null,
      OR: [
        { id: { in: contactIds } },
        ...insensitiveAny("email", invoiceAddresses),
        { altEmails: { hasSome: invoiceAddresses } },
      ],
    },
    select: CONTACT_SELECT,
  });
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const contactByAddress = new Map<string, (typeof contacts)[number]>();
  for (const c of contacts) {
    for (const a of contactAddresses(c)) if (!contactByAddress.has(a)) contactByAddress.set(a, c);
  }

  const resolved = invoices.map((inv) => ({
    inv,
    contact:
      (inv.contactId ? contactById.get(inv.contactId) : undefined) ??
      contactByAddress.get(normaliseEmail(inv.clientEmail)) ??
      null,
  }));

  // Opt-outs and earlier asks, matched on every address the contact has plus its id
  const people = [
    ...new Map(resolved.flatMap((r) => (r.contact ? [[r.contact.id, r.contact]] : []))).values(),
  ];
  const peopleIds = people.map((p) => p.id);
  const peopleAddresses = [...new Set(people.flatMap((p) => contactAddresses(p)))];

  const [mailingOptOuts, reviewOptOuts, askedInvoices, askedBookings] = await Promise.all([
    prisma.emailOptOut.findMany({
      where: { OR: [{ contactId: { in: peopleIds } }, { email: { in: peopleAddresses } }] },
      select: { email: true, contactId: true },
    }),
    prisma.reviewAskOptOut.findMany({
      where: { OR: [{ contactId: { in: peopleIds } }, { email: { in: peopleAddresses } }] },
      select: { email: true, contactId: true },
    }),
    prisma.invoice.findMany({
      where: {
        reviewLinkSentAt: { not: null },
        OR: [{ contactId: { in: peopleIds } }, ...insensitiveAny("clientEmail", peopleAddresses)],
      },
      select: { contactId: true, clientEmail: true, reviewLinkSentAt: true },
    }),
    prisma.booking.findMany({
      where: {
        reviewSentAt: { not: null },
        OR: insensitiveAny("email", peopleAddresses),
      },
      select: { email: true, reviewSentAt: true },
    }),
  ]);

  /**
   * Whether an opt-out list covers this contact.
   * @param rows - Opt-out rows.
   * @param id - Contact id.
   * @param addresses - The contact's addresses.
   * @returns True when any row matches the id or an address.
   */
  const optedOut = (
    rows: Array<{ email: string; contactId: string | null }>,
    id: string,
    addresses: string[],
  ): boolean => rows.some((r) => r.contactId === id || addresses.includes(normaliseEmail(r.email)));

  /**
   * The latest of the three "asked for a review" stamps for a contact.
   * @param contact - The contact, with its own stamp.
   * @param addresses - The contact's addresses.
   * @returns Latest ask, or null when never asked.
   */
  const lastAsked = (contact: (typeof contacts)[number], addresses: string[]): Date | null => {
    const stamps: Date[] = [];
    if (contact.reviewLinkSentAt) stamps.push(contact.reviewLinkSentAt);
    for (const i of askedInvoices) {
      if (
        i.reviewLinkSentAt &&
        (i.contactId === contact.id || addresses.includes(normaliseEmail(i.clientEmail)))
      )
        stamps.push(i.reviewLinkSentAt);
    }
    for (const b of askedBookings) {
      if (b.reviewSentAt && addresses.includes(normaliseEmail(b.email)))
        stamps.push(b.reviewSentAt);
    }
    return stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : null;
  };

  const candidates: ReviewAskCandidate[] = [];
  for (const { inv, contact } of resolved) {
    const clockStart = reviewAskClockStart(inv);
    if (!clockStart) continue;
    const addresses = contact ? contactAddresses(contact) : [];
    const address = contact ? pickReviewAskAddress(inv.clientEmail, contact) : null;
    const decision = decideReviewAsk(
      {
        status: inv.status,
        clockStart,
        hasContact: !!contact,
        address,
        reviewOptOut: contact ? optedOut(reviewOptOuts, contact.id, addresses) : false,
        mailingOptOut: contact ? optedOut(mailingOptOuts, contact.id, addresses) : false,
        lastAskedAt: contact ? lastAsked(contact, addresses) : null,
      },
      timing,
      now,
    );
    candidates.push({
      invoice: {
        id: inv.id,
        number: inv.number,
        clientName: inv.clientName,
        clientEmail: inv.clientEmail,
        status: inv.status,
        clockStart,
        outcome: inv.reviewAskOutcome ?? null,
        attempts: inv.reviewAskAttempts ?? 0,
      },
      contact: contact
        ? {
            id: contact.id,
            name: contact.name,
            company: contact.company,
            email: contact.email,
            altEmails: contact.altEmails,
            reviewToken: contact.reviewToken,
          }
        : null,
      address,
      decision,
    });
  }
  return candidates;
}

/**
 * What an invoice's automatic review ask will do if the invoice is sent now, for the send
 * modal. Judges the same rules the job does at the due date, and also counts asks still
 * queued on the person's other invoices: of several invoices sent close together, only
 * the first ask goes out and the gap skips the rest.
 * @param invoice - The invoice being sent.
 * @param invoice.id - Invoice id, left out of the queued asks.
 * @param invoice.contactId - Optional Contact id.
 * @param invoice.clientEmail - Invoice's client email.
 * @param invoice.sentAt - Set when the invoice went out before (a re-send).
 * @param timing - Delay and gap from settings.
 * @param now - Current instant.
 * @returns Modal info: due date, and the skip that will apply with the ask behind it.
 */
export async function forecastInvoiceReviewAsk(
  invoice: { id: string; contactId: string | null; clientEmail: string; sentAt: Date | null },
  timing: ReviewAskTiming,
  now: Date,
): Promise<InvoiceReviewAskInfo> {
  // Sending stamps sentAt when it's empty, so an unsent invoice's clock starts now.
  const dueAt = reviewAskDueAt(invoice.sentAt ?? now, timing.delayDays);
  const info: InvoiceReviewAskInfo = {
    delayDays: timing.delayDays,
    dueLabel: formatDateShort(dueAt),
    gapDays: timing.gapDays,
    skip: null,
    blockingAsk: null,
  };

  const contact = await findInvoiceContact(invoice);
  if (!contact) return { ...info, skip: "no_contact" };

  const addresses = contactAddresses(contact);
  const [state, queuedInvoices] = await Promise.all([
    contactReviewAskState(contact.id),
    prisma.invoice.findMany({
      where: {
        id: { not: invoice.id },
        status: { in: ["SENT", "PAID"] },
        AND: [
          NOT_A_QUOTE_FILTER,
          { OR: [{ contactId: contact.id }, ...insensitiveAny("clientEmail", addresses)] },
          {
            OR: [
              { reviewAskOutcome: null },
              { reviewAskOutcome: { isSet: false } },
              { reviewAskOutcome: "sending" },
            ],
          },
        ],
      },
      select: { status: true, sentAt: true, paidAt: true },
    }),
  ]);

  // Play the queued asks forward in due order: each one that clears the gap goes out
  // and becomes the latest ask. An overdue one goes out on the next run, so it counts
  // from now.
  let lastAsk = state.lastAskedAt;
  let lastAskQueued = false;
  if (timing.gapDays > 0) {
    const queuedDues = queuedInvoices
      .map((q) => reviewAskClockStart(q))
      .filter((d): d is Date => !!d)
      .map((start) => reviewAskDueAt(start, timing.delayDays))
      .sort((a, b) => a.getTime() - b.getTime());
    for (const due of queuedDues) {
      if (due > dueAt) break;
      const at = due < now ? now : due;
      if (!lastAsk || at.getTime() - lastAsk.getTime() >= timing.gapDays * DAY_MS) {
        lastAsk = at;
        lastAskQueued = true;
      }
    }
  }

  const decision = decideReviewAsk(
    {
      status: "SENT",
      clockStart: invoice.sentAt ?? now,
      hasContact: true,
      address: pickReviewAskAddress(invoice.clientEmail, contact),
      reviewOptOut: state.blockedBy === "review_opt_out",
      mailingOptOut: state.blockedBy === "mailing_opt_out",
      lastAskedAt: lastAsk,
    },
    timing,
    now,
  );
  const skip =
    decision.action === "skip"
      ? decision.reason
      : decision.action === "wait"
        ? decision.forecast
        : null;
  return {
    ...info,
    skip,
    blockingAsk:
      skip === "asked_recently" && lastAsk
        ? { label: formatDateShort(lastAsk), queued: lastAskQueued }
        : null,
  };
}

/** A decided review ask, for the admin "last 14 days" panel. */
export interface ReviewAskOutcomeRow {
  invoiceId: string;
  number: string;
  clientName: string;
  outcome: ReviewAskOutcome;
  note: string | null;
  decidedAt: Date;
  attempts: number;
}

/**
 * Review asks decided in the last `days` days, newest first. Skips stamped by the
 * launch backfill are left out - they say nothing about recent jobs.
 * @param now - Current instant.
 * @param days - How far back to look.
 * @returns Decided rows.
 */
export async function loadRecentReviewAskOutcomes(
  now: Date,
  days: number,
): Promise<ReviewAskOutcomeRow[]> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.invoice.findMany({
    where: {
      reviewAskDecidedAt: { gte: since },
      reviewAskOutcome: { in: ["sent", "skipped", "cancelled", "failed", "sending"] },
    },
    orderBy: { reviewAskDecidedAt: "desc" },
    take: 100,
    select: {
      id: true,
      number: true,
      clientName: true,
      reviewAskOutcome: true,
      reviewAskNote: true,
      reviewAskDecidedAt: true,
      reviewAskAttempts: true,
    },
  });
  // The before_auto filter runs here, not in the query: on Mongo a NOT on a field also
  // drops every row where that field is unset, which is most of them.
  return rows.flatMap((r) =>
    r.reviewAskOutcome && r.reviewAskDecidedAt && r.reviewAskNote !== "before_auto"
      ? [
          {
            invoiceId: r.id,
            number: r.number,
            clientName: r.clientName,
            outcome: r.reviewAskOutcome,
            note: r.reviewAskNote,
            decidedAt: r.reviewAskDecidedAt,
            attempts: r.reviewAskAttempts ?? 0,
          },
        ]
      : [],
  );
}
