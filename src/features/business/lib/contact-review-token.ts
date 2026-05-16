// src/features/business/lib/contact-review-token.ts
/**
 * @file contact-review-token.ts
 * @description Lazy generator for the per-contact review token used in invoice emails.
 */

import { randomUUID } from "crypto";
import { prisma } from "@/shared/lib/prisma";

/**
 * Returns the contact's stable review token, creating + persisting one on first call.
 * Wrapped in try/catch so a sync failure never blocks invoice creation.
 * @param contactId - Contact ObjectId.
 * @returns Token string, or null if the contact doesn't exist or DB write failed.
 */
export async function ensureContactReviewToken(contactId: string): Promise<string | null> {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
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
 * Resolves a review URL for an invoice. Tries the contactId path first, then
 * falls back to matching the invoice's clientEmail against existing contacts.
 * @param args - Lookup inputs.
 * @param args.contactId - Optional Contact id from the invoice.
 * @param args.clientEmail - Invoice's clientEmail (case-insensitive match).
 * @param args.siteUrl - Public origin to prefix the review URL with.
 * @returns Full review URL or null when no contact can be resolved.
 */
export async function resolveInvoiceReviewUrl(args: {
  contactId: string | null | undefined;
  clientEmail: string | null | undefined;
  siteUrl: string;
}): Promise<string | null> {
  const { contactId, clientEmail, siteUrl } = args;

  if (contactId) {
    const token = await ensureContactReviewToken(contactId);
    if (token) return `${siteUrl}/review?token=${token}`;
  }

  if (clientEmail && clientEmail.trim()) {
    try {
      const match = await prisma.contact.findFirst({
        where: { email: { equals: clientEmail.trim(), mode: "insensitive" } },
        select: { id: true, reviewToken: true },
      });
      if (match) {
        const token = match.reviewToken ?? (await ensureContactReviewToken(match.id));
        if (token) return `${siteUrl}/review?token=${token}`;
      }
    } catch (err) {
      console.error("[resolveInvoiceReviewUrl] email lookup failed", err);
    }
  }

  return null;
}
