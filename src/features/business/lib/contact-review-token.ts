// src/features/business/lib/contact-review-token.ts
// The per-contact review token behind a review ask's site-form link, and the read-only
// "is this invoice's customer in Contacts?" check the send modal shows.

import { prisma } from "@/shared/lib/prisma";
import { randomUUID } from "crypto";

/**
 * Returns the contact's stable review token, creating + persisting one on first call.
 * Writes the Contact (which re-pushes it to Google), so only call it once an ask is
 * actually going out.
 * @param contactId - Contact ObjectId.
 * @returns Token string, or null if the contact doesn't exist or DB write failed.
 */
export async function ensureContactReviewToken(contactId: string): Promise<string | null> {
  try {
    // Soft-deleted contacts are excluded: an invoice keeps its contactId after the
    // contact is deleted, so minting here would email someone who had been removed.
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, deletedAt: null },
      select: { reviewToken: true },
    });
    if (!contact) return null;
    if (contact.reviewToken) return contact.reviewToken;

    const token = randomUUID();
    await prisma.contact.update({
      where: { id: contactId },
      data: { reviewToken: token },
    });
    return token;
  } catch (err) {
    console.error("[ensureContactReviewToken] failed for", contactId, err);
    return null;
  }
}

/**
 * Whether a live contact matches an invoice, by its contactId or its client email. The
 * same match the review-ask job uses; without one the ask is skipped. Read-only.
 * @param args - Lookup inputs.
 * @param args.contactId - Optional Contact id from the invoice.
 * @param args.clientEmail - Invoice's clientEmail (case-insensitive match).
 * @returns True when a contact matches.
 */
export async function invoiceHasContact({
  contactId,
  clientEmail,
}: {
  contactId: string | null | undefined;
  clientEmail: string | null | undefined;
}): Promise<boolean> {
  const email = clientEmail?.trim().toLowerCase();
  const or = [
    ...(contactId ? [{ id: contactId }] : []),
    ...(email
      ? [{ email: { equals: email, mode: "insensitive" as const } }, { altEmails: { has: email } }]
      : []),
  ];
  if (or.length === 0) return false;
  const match = await prisma.contact.findFirst({
    where: { deletedAt: null, OR: or },
    select: { id: true },
  });
  return match !== null;
}
