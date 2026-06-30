// src/features/business/lib/contact-review-token.ts
/**
 * @description Lazy generator for the per-contact review token used in invoice emails.
 */

import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { randomUUID } from "crypto";

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
export async function resolveInvoiceReviewUrl({
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
      const match = await prisma.contact.findFirst({
        where: { email: { equals: trimmedEmail, mode: "insensitive" } },
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
 * checkbox state in the invoice send modal.
 */
export type InvoiceReviewEligibility =
  | { canSend: true; reviewUrl: string }
  | { canSend: false; reason: "no-contact" }
  | { canSend: false; reason: "already-reviewed"; reviewUrl: string }
  | {
      canSend: false;
      reason: "sent-recently";
      reviewUrl: string;
      lastSentAt: string;
      nextAllowedAt: string;
    };

/**
 * Decides whether the invoice email should include the review link.
 * Returns `reviewUrl` even when blocked so the operator can preview it; the
 * UI gates the checkbox and the send route gates actual inclusion.
 * Verdicts: `no-contact` / `already-reviewed` / `sent-recently` / `canSend: true`.
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

  const cooldownDays = (await getSettings()).reviews.invoiceReviewCooldownDays;

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

  if (reviewedClauses.length > 0) {
    try {
      const existing = await prisma.review.findFirst({
        where: { OR: reviewedClauses },
        select: { id: true },
      });
      if (existing) {
        return { canSend: false, reason: "already-reviewed", reviewUrl };
      }
    } catch (err) {
      // Soft-fail: a DB hiccup here should not block sending. The cooldown
      // check below still protects against spam.
      console.error("[getInvoiceReviewEligibility] reviewed lookup failed", err);
    }
  }

  const trimmedEmail = clientEmail?.trim();
  if (trimmedEmail) {
    const cooldownStart = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);
    try {
      // Three sources of "was asked recently":
      // - Booking.reviewSentAt (cron auto-send + admin "mark complete" + manual resend)
      // - Contact.reviewLinkSentAt (manual "Send a review link" admin sends)
      // - Invoice.reviewLinkSentAt (prior invoice that included the review line)
      const [recentBooking, recentContact, recentInvoice] = await Promise.all([
        prisma.booking.findFirst({
          where: {
            email: { equals: trimmedEmail, mode: "insensitive" },
            reviewSentAt: { gte: cooldownStart },
          },
          select: { reviewSentAt: true },
          orderBy: { reviewSentAt: "desc" },
        }),
        prisma.contact.findFirst({
          where: {
            email: { equals: trimmedEmail, mode: "insensitive" },
            reviewLinkSentAt: { gte: cooldownStart },
          },
          select: { reviewLinkSentAt: true },
          orderBy: { reviewLinkSentAt: "desc" },
        }),
        prisma.invoice.findFirst({
          where: {
            clientEmail: { equals: trimmedEmail, mode: "insensitive" },
            reviewLinkSentAt: { gte: cooldownStart },
          },
          select: { reviewLinkSentAt: true },
          orderBy: { reviewLinkSentAt: "desc" },
        }),
      ]);

      const candidates = [
        recentBooking?.reviewSentAt,
        recentContact?.reviewLinkSentAt,
        recentInvoice?.reviewLinkSentAt,
      ].filter((d): d is Date => d instanceof Date);
      const lastSent = candidates.sort((a, b) => b.getTime() - a.getTime())[0];

      if (lastSent) {
        const nextAllowed = new Date(lastSent.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
        return {
          canSend: false,
          reason: "sent-recently",
          reviewUrl,
          lastSentAt: lastSent.toISOString(),
          nextAllowedAt: nextAllowed.toISOString(),
        };
      }
    } catch (err) {
      console.error("[getInvoiceReviewEligibility] cooldown lookup failed", err);
    }
  }

  return { canSend: true, reviewUrl };
}
