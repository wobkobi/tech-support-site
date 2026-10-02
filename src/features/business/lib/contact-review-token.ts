// src/features/business/lib/contact-review-token.ts
// Lazy generator for the per-contact review token used in invoice emails.

import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { randomUUID } from "crypto";

/**
 * Returns the contact's stable review token, creating + persisting one on first call.
 * Wrapped in try/catch so a sync failure never blocks invoice creation.
 * @param contactId - Contact ObjectId.
 * @returns Token string, or null if the contact doesn't exist or DB write failed.
 */
async function ensureContactReviewToken(contactId: string): Promise<string | null> {
  try {
    // Soft-deleted contacts are excluded here too, not just on the email-match path below:
    // an invoice keeps its contactId after the contact is deleted, so a re-send would mint
    // a fresh reviewToken onto the deleted row and email someone who had been removed.
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

interface InvoiceReviewLookupArgs {
  contactId: string | null | undefined;
  clientEmail: string | null | undefined;
  siteUrl: string;
}

/**
 * Resolves a review URL for an invoice. Tries the contactId path first, then
 * falls back to matching the invoice's clientEmail against existing contacts.
 * Pure resolver - no policy decisions. See {@link getInvoiceReviewEligibility} for
 * the "should we actually ask this customer right now" check.
 * @param args - Lookup inputs.
 * @param args.contactId - Optional Contact id from the invoice.
 * @param args.clientEmail - Invoice's clientEmail (case-insensitive match).
 * @param args.siteUrl - Public origin to prefix the review URL with.
 * @returns Full review URL or null when no contact can be resolved.
 */
async function resolveInvoiceReviewUrl({
  contactId,
  clientEmail,
  siteUrl,
}: InvoiceReviewLookupArgs): Promise<string | null> {
  if (contactId) {
    const token = await ensureContactReviewToken(contactId);
    if (token) return `${siteUrl}/review?token=${token}`;
  }

  const trimmedEmail = clientEmail?.trim();
  if (trimmedEmail) {
    try {
      const lowerEmail = trimmedEmail.toLowerCase();
      const match = await prisma.contact.findFirst({
        where: {
          OR: [
            { email: { equals: trimmedEmail, mode: "insensitive" } },
            { altEmails: { has: lowerEmail } },
          ],
          deletedAt: null,
        },
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
/**
 * Result of {@link getInvoiceReviewEligibility}. Drives the "Include review link"
 * checkbox state in the invoice send modal. `googleOnly` marks a customer who has
 * already reviewed on the site: `reviewUrl` is then the Google link.
 */
export type InvoiceReviewEligibility =
  | { canSend: true; reviewUrl: string; googleOnly: boolean }
  | { canSend: false; reason: "no-contact" }
  | { canSend: false; reason: "already-reviewed"; reviewUrl: string };

/**
 * Decides which review ask the invoice email carries. Every invoice asks; only
 * the wording changes. A customer who hasn't reviewed gets the site link (with
 * Google offered beside it); one who has reviewed on the site is thanked and
 * asked for Google instead (`googleOnly`). Every site reviewer gets that ask
 * whatever they wrote, which keeps it clear of Google's ban on soliciting only
 * happy customers.
 *
 * Blocked only when there is nothing to send: no contact to mint a review link
 * for (`no-contact`), or a site reviewer with no Google link set
 * (`already-reviewed`). Returns `reviewUrl` even then so the operator can
 * preview it; the UI gates the checkbox and the send route gates inclusion.
 * @param args - Lookup inputs.
 * @param args.contactId - Optional Contact id from the invoice.
 * @param args.clientEmail - Invoice's clientEmail (case-insensitive).
 * @param args.siteUrl - Public origin to prefix the review URL with.
 * @returns Eligibility verdict + URL when one can be resolved.
 */
export async function getInvoiceReviewEligibility({
  contactId,
  clientEmail,
  siteUrl,
}: InvoiceReviewLookupArgs): Promise<InvoiceReviewEligibility> {
  const reviewUrl = await resolveInvoiceReviewUrl({ contactId, clientEmail, siteUrl });
  if (!reviewUrl) {
    return { canSend: false, reason: "no-contact" };
  }

  // Pull the token out of the URL for the customerRef cross-check (Review
  // rows submitted via a magic link store the token in `customerRef`).
  const tokenFromUrl = (() => {
    try {
      return new URL(reviewUrl).searchParams.get("token");
    } catch {
      return null;
    }
  })();

  const reviewedClauses: Array<{ contactId?: string; customerRef?: string }> = [];
  if (contactId) reviewedClauses.push({ contactId });
  if (tokenFromUrl) reviewedClauses.push({ customerRef: tokenFromUrl });

  let reviewed = false;
  if (reviewedClauses.length > 0) {
    try {
      reviewed =
        (await prisma.review.findFirst({
          where: { OR: reviewedClauses },
          select: { id: true },
        })) !== null;
    } catch (err) {
      // Soft-fail to the site ask: a DB hiccup should not drop the review line.
      console.error("[getInvoiceReviewEligibility] reviewed lookup failed", err);
    }
  }
  if (!reviewed) return { canSend: true, reviewUrl, googleOnly: false };

  const googleUrl = (await getSettings()).reviews.googleReviewUrl.trim();
  if (!googleUrl) return { canSend: false, reason: "already-reviewed", reviewUrl };
  return { canSend: true, reviewUrl: googleUrl, googleOnly: true };
}
