// src/app/api/admin/send-review-link/route.ts
// Sends a review link to a past client, with all send-state on the Contact. Someone already
// asked gets their link back unless `resend`, which re-sends under the same token.

import {
  findOrCreateContactByEmail,
  findOrCreateContactByPhone,
} from "@/features/contacts/lib/find-or-create";
import { brandName } from "@/features/reviews/lib/email-core";
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
 * Sends a review link via email or SMS and stamps the state onto the Contact.
 * @param request - The incoming request.
 * @returns JSON with reviewUrl (`existing` and `askedAt` when already asked); SMS also
 * returns `smsText` built from live identity settings.
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

    // Already sent: return the same URL so old emails keep working, unless `resend`.
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
      // A mailing unsubscribe doesn't stop a hand-sent text; a review opt-out does.
      if (blockedBy === "review_opt_out") {
        return errorResponse("They've asked not to get review requests.", 409);
      }
      // No SMS provider yet: persist the token only, since nothing was actually sent.
      // TODO: wire a real SMS provider, then stamp send-state like the email path.
      if (!contact.reviewToken) {
        await prisma.contact.update({ where: { id: contact.id }, data: { reviewToken } });
      }
      const [identity, { reviews }] = await Promise.all([getIdentity(), getSettings()]);
      // A contact saved with only an email address has it as their name.
      const first = name.trim().split(" ")[0] ?? "";
      const greeting =
        `Hi ${first.includes("@") ? "there" : first}, ${identity.name.split(" ")[0]} here from ` +
        `${brandName(identity)}. Thanks for having me out, I hope everything's still working well.`;
      // Google first, like the email; their /review link is the fallback.
      const googleUrl = reviews.googleReviewUrl.trim();
      const smsText = googleUrl
        ? `${greeting} If you've got a minute, a quick Google review would really help ` +
          `other people find me: ${googleUrl}\n\nNo Google account? You can leave one here ` +
          `instead: ${reviewFormUrl(reviewToken)}`
        : `${greeting} If you've got a minute, a quick review would really help other ` +
          `people find me: ${reviewUrl}`;
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

    // Stamp only after a successful send, or retries short-circuit at the dedup guard.
    const result = await sendReviewAsk({
      to: normalisedEmail!,
      firstName: name.trim().split(" ")[0] ?? "",
      contactId: contact.id,
      reviewToken,
    });

    if (result !== "sent") {
      // Keep the token for the retry but leave send-state unstamped.
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
