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

/** The contact an invoice's review link is minted for. */
interface InvoiceReviewContact {
  id: string;
  token: string;
  /** Tokens carried over from merged contacts; /api/reviews accepts them too. */
  altReviewTokens: string[];
}

/**
 * Resolves the contact behind an invoice's review link. Tries the contactId path
 * first, then falls back to matching the invoice's clientEmail against existing
 * contacts. Pure resolver - no policy decisions. See
 * {@link getInvoiceReviewEligibility} for which ask the email carries.
 * @param args - Lookup inputs.
 * @param args.contactId - Optional Contact id from the invoice.
 * @param args.clientEmail - Invoice's clientEmail (case-insensitive match).
 * @returns The contact with its review token, or null when none can be resolved.
 */
async function resolveInvoiceReviewContact({
  contactId,
  clientEmail,
}: Omit<InvoiceReviewLookupArgs, "siteUrl">): Promise<InvoiceReviewContact | null> {
  const select = { id: true, reviewToken: true, altReviewTokens: true } as const;
  /**
   * Fills in the contact's review token, minting one if it has none yet.
   * @param match - The matched contact row.
   * @param match.id - Contact id.
   * @param match.reviewToken - Stored token, or null before the first invoice ask.
   * @param match.altReviewTokens - Tokens inherited from merged contacts.
   * @returns The resolved contact, or null if the token couldn't be minted.
   */
  const withToken = async (match: {
    id: string;
    reviewToken: string | null;
    altReviewTokens: string[];
  }): Promise<InvoiceReviewContact | null> => {
    const token = match.reviewToken ?? (await ensureContactReviewToken(match.id));
    return token ? { id: match.id, token, altReviewTokens: match.altReviewTokens } : null;
  };

  try {
    if (contactId) {
      const match = await prisma.contact.findFirst({
        where: { id: contactId, deletedAt: null },
        select,
      });
      const resolved = match && (await withToken(match));
      if (resolved) return resolved;
    }

    const trimmedEmail = clientEmail?.trim();
    if (trimmedEmail) {
      const match = await prisma.contact.findFirst({
        where: {
          OR: [
            { email: { equals: trimmedEmail, mode: "insensitive" } },
            { altEmails: { has: trimmedEmail.toLowerCase() } },
          ],
          deletedAt: null,
        },
        select,
      });
      if (match) return await withToken(match);
    }
  } catch (err) {
    console.error("[resolveInvoiceReviewContact] contact lookup failed", err);
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
  const contact = await resolveInvoiceReviewContact({ contactId, clientEmail });
  if (!contact) {
    return { canSend: false, reason: "no-contact" };
  }
  const reviewUrl = `${siteUrl}/review?token=${contact.token}`;

  // A review counts whichever link it came through: linked to the contact (booking
  // links stamp contactId), or carrying one of the contact's tokens in customerRef
  // (including tokens inherited from a merge). Uses the resolved contact rather than
  // the invoice's contactId, so an email-matched invoice still finds a booking review.
  let reviewed = false;
  try {
    reviewed =
      (await prisma.review.findFirst({
        where: {
          OR: [
            { contactId: contact.id },
            { customerRef: { in: [contact.token, ...contact.altReviewTokens] } },
          ],
        },
        select: { id: true },
      })) !== null;
  } catch (err) {
    // Soft-fail to the site ask: a DB hiccup should not drop the review line.
    console.error("[getInvoiceReviewEligibility] reviewed lookup failed", err);
  }
  if (!reviewed) return { canSend: true, reviewUrl, googleOnly: false };

  const googleUrl = (await getSettings()).reviews.googleReviewUrl.trim();
  if (!googleUrl) return { canSend: false, reason: "already-reviewed", reviewUrl };
  return { canSend: true, reviewUrl: googleUrl, googleOnly: true };
}
