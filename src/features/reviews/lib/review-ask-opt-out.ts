// src/features/reviews/lib/review-ask-opt-out.ts
// Records and reverses "stop asking me for reviews". Every address a contact uses is
// opted out together, as with the mailing-list unsubscribe, so a merged contact's second
// address can't keep getting asked. Separate from the mailing opt-out: someone can keep
// the newsletter and drop review asks.

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
 * Whether either opt-out blocks review asks to this contact: their own "stop asking me
 * for reviews", or a mailing-list unsubscribe (a review ask is outreach, not a
 * transactional email).
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
 * The writes that point a merged-away contact's opt-out rows (mailing and review asks)
 * at the surviving contact, for the merge's own transaction. Opt-out rows hold a bare
 * contactId, so without this a merge leaves them pointing at a deleted contact and the
 * by-id match stops protecting the person.
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
