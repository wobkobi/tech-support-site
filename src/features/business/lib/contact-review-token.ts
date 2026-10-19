// src/features/business/lib/contact-review-token.ts
// Per-contact review token for review-ask links, and the invoice > contact lookup.

import { prisma } from "@/shared/lib/prisma";
import { randomUUID } from "crypto";

/**
 * Returns the contact's review token, creating one on first call. The write re-pushes the
 * Contact to Google, so call it only when an ask is going out.
 * @param contactId - Contact ObjectId.
 * @returns Token string, or null if the contact doesn't exist or DB write failed.
 */
export async function ensureContactReviewToken(contactId: string): Promise<string | null> {
  try {
    // Invoices keep contactId after a soft delete, so skip deleted contacts.
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
 * The live contact an invoice belongs to, by contactId or client email (the review-ask match).
 * @param args - Lookup inputs.
 * @param args.contactId - Optional Contact id from the invoice.
 * @param args.clientEmail - Invoice's clientEmail (case-insensitive match).
 * @returns The contact's id and addresses, or null when none matches.
 */
export async function findInvoiceContact({
  contactId,
  clientEmail,
}: {
  contactId: string | null | undefined;
  clientEmail: string | null | undefined;
}): Promise<{ id: string; email: string | null; altEmails: string[] } | null> {
  const email = clientEmail?.trim().toLowerCase();
  const or = [
    ...(contactId ? [{ id: contactId }] : []),
    ...(email
      ? [{ email: { equals: email, mode: "insensitive" as const } }, { altEmails: { has: email } }]
      : []),
  ];
  if (or.length === 0) return null;
  return prisma.contact.findFirst({
    where: { deletedAt: null, OR: or },
    select: { id: true, email: true, altEmails: true },
  });
}
