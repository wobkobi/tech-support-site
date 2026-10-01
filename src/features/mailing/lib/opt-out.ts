// src/features/mailing/lib/opt-out.ts
// Records and reverses mailing-list unsubscribes. Every address a contact uses is
// opted out together, so a merged contact's second address can't keep getting emails.

import { normaliseEmail } from "@/shared/lib/normalise-email";
import { prisma } from "@/shared/lib/prisma";
import type { EmailOptOutSource } from "@prisma/client";

/**
 * Opts a contact out of mailing-list emails.
 * @param contactId - Contact id.
 * @param source - How the request arrived.
 * @returns False when the contact doesn't exist or has no email.
 */
export async function optOutContact(
  contactId: string,
  source: EmailOptOutSource,
): Promise<boolean> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { email: true, altEmails: true },
  });
  if (!contact) return false;
  const emails = [...new Set([contact.email, ...contact.altEmails].map(normaliseEmail))].filter(
    Boolean,
  );
  if (emails.length === 0) return false;
  // Upsert one by one: a repeat click must not trip the unique index.
  for (const email of emails) {
    await prisma.emailOptOut.upsert({
      where: { email },
      create: { email, contactId, source },
      update: {},
    });
  }
  return true;
}

/**
 * Re-subscribes a contact by removing every opt-out tied to them, by id or by
 * any address they use.
 * @param contactId - Contact id.
 */
export async function resubscribeContact(contactId: string): Promise<void> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { email: true, altEmails: true },
  });
  const emails = [contact?.email, ...(contact?.altEmails ?? [])]
    .map(normaliseEmail)
    .filter(Boolean);
  await prisma.emailOptOut.deleteMany({
    where: { OR: [{ contactId }, { email: { in: emails } }] },
  });
}

/**
 * Whether a contact is currently opted out.
 * @param contactId - Contact id.
 * @returns True when any opt-out row matches them.
 */
export async function isContactOptedOut(contactId: string): Promise<boolean> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { email: true },
  });
  const email = normaliseEmail(contact?.email);
  const count = await prisma.emailOptOut.count({
    where: { OR: [{ contactId }, ...(email ? [{ email }] : [])] },
  });
  return count > 0;
}
