// src/features/reviews/lib/review-ask-opt-out.ts
// Records and reverses "stop asking me for reviews" across every address a contact uses.
// Separate from the mailing opt-out, so someone can keep the newsletter.

import { contactAddresses } from "@/features/reviews/lib/review-ask-rules";

import { prisma } from "@/shared/lib/prisma";
import type { EmailOptOutSource, Prisma } from "@prisma/client";

/**
 * Opts a contact out of review asks.
 * @param contactId - Contact id.
 * @param source - How the request arrived.
 * @returns False when the contact doesn't exist or has no email.
 */
export async function optOutOfReviewAsks(
  contactId: string,
  source: EmailOptOutSource,
): Promise<boolean> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { email: true, altEmails: true },
  });
  if (!contact) return false;
  const emails = contactAddresses(contact);
  if (emails.length === 0) return false;
  // Upsert one by one: a repeat click must not trip the unique index.
  for (const email of emails) {
    await prisma.reviewAskOptOut.upsert({
      where: { email },
      create: { email, contactId, source },
      update: {},
    });
  }
  return true;
}

/**
 * Lets review asks reach a contact again by removing every opt-out tied to them, by id
 * or by any address they use.
 * @param contactId - Contact id.
 */
export async function allowReviewAsks(contactId: string): Promise<void> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { email: true, altEmails: true },
  });
  const emails = contact ? contactAddresses(contact) : [];
  await prisma.reviewAskOptOut.deleteMany({
    where: { OR: [{ contactId }, { email: { in: emails } }] },
  });
}

/**
 * Whether a contact has asked not to get review asks.
 * @param contactId - Contact id.
 * @returns True when any opt-out row matches them by id or by any of their addresses.
 */
export async function isReviewAskOptedOut(contactId: string): Promise<boolean> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { email: true, altEmails: true },
  });
  const emails = contact ? contactAddresses(contact) : [];
  const count = await prisma.reviewAskOptOut.count({
    where: { OR: [{ contactId }, ...(emails.length ? [{ email: { in: emails } }] : [])] },
  });
  return count > 0;
}

/**
 * Whether a review-ask opt-out or a mailing-list unsubscribe blocks review asks to this contact.
 * @param contactId - Contact id.
 * @returns Which opt-out applies, or null when asks may go out.
 */
export async function reviewAskBlockedBy(
  contactId: string,
): Promise<"review_opt_out" | "mailing_opt_out" | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { email: true, altEmails: true },
  });
  const emails = contact ? contactAddresses(contact) : [];
  const where = { OR: [{ contactId }, ...(emails.length ? [{ email: { in: emails } }] : [])] };
  const [review, mailing] = await Promise.all([
    prisma.reviewAskOptOut.count({ where }),
    prisma.emailOptOut.count({ where }),
  ]);
  if (review > 0) return "review_opt_out";
  if (mailing > 0) return "mailing_opt_out";
  return null;
}

/**
 * Writes that repoint a merged-away contact's opt-out rows (mailing and review) at the
 * survivor, for the merge transaction; rows hold a bare contactId.
 * @param fromId - Contact id being merged away.
 * @param toId - The surviving contact id.
 * @returns Prisma operations to include in a `$transaction`.
 */
export function optOutRepointOps(
  fromId: string,
  toId: string,
): Prisma.PrismaPromise<Prisma.BatchPayload>[] {
  return [
    prisma.emailOptOut.updateMany({ where: { contactId: fromId }, data: { contactId: toId } }),
    prisma.reviewAskOptOut.updateMany({ where: { contactId: fromId }, data: { contactId: toId } }),
  ];
}

/** A contact's review-ask state, for their admin page. */
export interface ContactReviewAskState {
  /** Latest ask by any route: manual link, invoice ask or booking request. */
  lastAskedAt: Date | null;
  blockedBy: "review_opt_out" | "mailing_opt_out" | null;
}

/**
 * The latest review ask to a contact across all three places one is stamped, and
 * whether an opt-out now blocks them.
 * @param contactId - Contact id.
 * @returns Last ask and blocking opt-out; nulls when the contact doesn't exist.
 */
export async function contactReviewAskState(contactId: string): Promise<ContactReviewAskState> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { email: true, altEmails: true, reviewLinkSentAt: true },
  });
  if (!contact) return { lastAskedAt: null, blockedBy: null };
  const emails = contactAddresses(contact);
  const invoiceByEmail = emails.map((e) => ({
    clientEmail: { equals: e, mode: "insensitive" as const },
  }));
  const bookingByEmail = emails.map((e) => ({
    email: { equals: e, mode: "insensitive" as const },
  }));
  const [invoice, booking, blockedBy] = await Promise.all([
    prisma.invoice.findFirst({
      where: { reviewLinkSentAt: { not: null }, OR: [{ contactId }, ...invoiceByEmail] },
      orderBy: { reviewLinkSentAt: "desc" },
      select: { reviewLinkSentAt: true },
    }),
    emails.length
      ? prisma.booking.findFirst({
          where: { reviewSentAt: { not: null }, OR: bookingByEmail },
          orderBy: { reviewSentAt: "desc" },
          select: { reviewSentAt: true },
        })
      : null,
    reviewAskBlockedBy(contactId),
  ]);
  const stamps = [contact.reviewLinkSentAt, invoice?.reviewLinkSentAt, booking?.reviewSentAt]
    .filter((d): d is Date => !!d)
    .map((d) => d.getTime());
  return { lastAskedAt: stamps.length ? new Date(Math.max(...stamps)) : null, blockedBy };
}
