// src/app/api/admin/send-review-link/route.ts
// Admin endpoint to send a review request link to a past client. Lands a Contact
// (creating one if needed), ensures Contact.reviewToken is set, stamps
// Contact.reviewLinkSentAt, then sends the email/SMS. All send-state lives on the Contact
// row. Someone already asked gets their existing link back unless the request says
// `resend`, which sends the ask again under the same token so older links keep working.

import {
  findOrCreateContactByEmail,
  findOrCreateContactByPhone,
} from "@/features/contacts/lib/find-or-create";
import { reviewFormUrl, sendReviewAsk } from "@/features/reviews/lib/email-review-ask";
import { reviewAskBlockedBy } from "@/features/reviews/lib/review-ask-opt-out";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { isValidPhone, toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";
import { ReviewLinkMode } from "@prisma/client";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/send-review-link
 * Sends a review link to a past client via email or SMS and stamps the state
 * onto their Contact row. Authenticated via X-Admin-Secret header.
 * @param request - The incoming request.
 * @returns JSON with reviewUrl (and `existing: true` plus `askedAt` when they were
 * already asked and `resend` wasn't set). The SMS path also returns the ready-to-send
 * `smsText`, composed here so the operator's name and business name come from
 * the live identity settings rather than being hardcoded in the admin form.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    // Parse and validate body
    const body = (await request.json()) as {
      name?: string;
      email?: string;
      phone?: string;
      mode?: "email" | "sms";
      resend?: boolean;
    };
    const { name, email, phone, mode = "email" } = body;
    const resend = body.resend === true;

    if (mode !== "email" && mode !== "sms") {
      return errorResponse("mode must be 'email' or 'sms'.", 400);
    }
    if (!name?.trim()) {
      return errorResponse("Name is required.", 400);
    }
    if (mode === "email" && (!email?.trim() || !email.includes("@"))) {
      return errorResponse("Valid email is required.", 400);
    }

    const siteUrl = getSiteUrl();

    // Land the Contact first to identify the recipient.
    const normalisedEmail = mode === "email" ? normaliseEmail(email) : null;
    let normalisedPhone: string | null = null;
    if (mode === "sms") {
      if (!phone) {
        return errorResponse("Phone is required.", 400);
      }
      normalisedPhone = toE164NZ(phone);
      if (!isValidPhone(normalisedPhone)) {
        return errorResponse("Invalid phone number.", 400);
      }
    }

    const { contact } = normalisedEmail
      ? await findOrCreateContactByEmail(normalisedEmail, { name: name.trim() })
      : await findOrCreateContactByPhone(normalisedPhone!, { name: name.trim() });

    // Dedup: if this contact has already been sent a link, return the same URL
    // rather than rotating the token (so old emails keep working). `resend` skips
    // both checks - the operator has seen the earlier ask and wants another.
    if (!resend && contact.reviewLinkSentAt && contact.reviewToken) {
      const reviewUrl = `${siteUrl}/review?token=${contact.reviewToken}`;
      return NextResponse.json({
        ok: true,
        reviewUrl,
        existing: true,
        askedAt: contact.reviewLinkSentAt.toISOString(),
      });
    }

    // Dedup against the booking auto-send to avoid doubling up via a different channel.
    if (!resend && normalisedEmail) {
      const existingBooking = await prisma.booking.findFirst({
        where: {
          email: { equals: normalisedEmail, mode: "insensitive" },
          reviewSentAt: { not: null },
        },
        orderBy: { reviewSentAt: "desc" },
        select: { reviewToken: true, reviewSentAt: true },
      });
      if (existingBooking) {
        const reviewUrl = `${siteUrl}/review?token=${existingBooking.reviewToken}`;
        return NextResponse.json({
          ok: true,
          reviewUrl,
          existing: true,
          askedAt: existingBooking.reviewSentAt?.toISOString() ?? null,
        });
      }
    }

    // Ensure the contact carries a stable review token.
    const reviewToken = contact.reviewToken ?? randomUUID();
    const reviewUrl = `${siteUrl}/review?token=${reviewToken}`;

    const blockedBy = await reviewAskBlockedBy(contact.id);

    if (mode === "sms") {
      // A mailing-list unsubscribe is about email, so it doesn't stop a text the
      // operator sends by hand; "stop asking me for reviews" does.
      if (blockedBy === "review_opt_out") {
        return errorResponse("They've asked not to get review requests.", 409);
      }
      // No SMS provider yet: persist the token only, never the send-state. Stamping
      // reviewLinkSentAt would suppress the customer from future auto-sends when
      // nothing was actually sent.
      // TODO: wire a real SMS provider, then stamp send-state like the email path.
      if (!contact.reviewToken) {
        await prisma.contact.update({ where: { id: contact.id }, data: { reviewToken } });
      }
      const [identity, { reviews }] = await Promise.all([getIdentity(), getSettings()]);
      const greeting =
        `Hi ${name.trim().split(" ")[0]}, it's ${identity.name.split(" ")[0]} from ` +
        `${identity.company} Tech. Thanks for letting me help you out!`;
      // Google first, same as the email: one tap from the text straight to the review
      // box. Their own /review link stays as the fallback for anyone without Google.
      const googleUrl = reviews.googleReviewUrl.trim();
      const smsText = googleUrl
        ? `${greeting} A quick Google review would be greatly appreciated - it really ` +
          `helps: ${googleUrl}\n\nNo Google account? You can leave one here instead: ` +
          reviewFormUrl(reviewToken)
        : `${greeting} A quick review would be greatly appreciated - it really helps: ` + reviewUrl;
      return NextResponse.json({ ok: true, reviewUrl, smsText, copyOnly: true });
    }

    if (blockedBy) {
      return errorResponse(
        blockedBy === "review_opt_out"
          ? "They've asked not to get review requests."
          : "They've unsubscribed from your emails, so no review request was sent.",
        409,
      );
    }

    // Stamp the send-state only after a successful send: stamping first would mark the
    // customer "review requested" even on a Resend failure, so every retry would
    // short-circuit at the dedup guard above without re-sending.
    const result = await sendReviewAsk({
      to: normalisedEmail!,
      firstName: name.trim().split(" ")[0] ?? "",
      contactId: contact.id,
      reviewToken,
    });

    if (result !== "sent") {
      // Persist the token so a retry reuses the same link, but leave the
      // send-state unstamped so the retry actually re-sends.
      if (!contact.reviewToken) {
        await prisma.contact.update({ where: { id: contact.id }, data: { reviewToken } });
      }
      return result === "not_configured"
        ? errorResponse("Email isn't set up, so nothing was sent.", 503)
        : errorResponse("Failed to send review link.", 502);
    }

    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        reviewToken,
        reviewLinkSentAt: new Date(),
        reviewLinkSentMode: ReviewLinkMode.email,
      },
    });

    return NextResponse.json({ ok: true, reviewUrl });
  } catch (error) {
    console.error("[admin/send-review-link] Error:", error);
    return errorResponse("Failed to send review link.", 500);
  }
}
