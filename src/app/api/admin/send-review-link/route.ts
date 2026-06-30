// src/app/api/admin/send-review-link/route.ts
/**
 * @description Admin endpoint to send a review request link to a past client.
 * Lands a Contact (creating one if needed), ensures Contact.reviewToken is set,
 * stamps Contact.reviewLinkSentAt, then sends the email/SMS. All send-state
 * lives on the Contact row.
 */

import {
  findOrCreateContactByEmail,
  findOrCreateContactByPhone,
} from "@/features/contacts/lib/find-or-create";
import { sendPastClientReviewRequest } from "@/features/reviews/lib/email";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { isValidPhone, toE164NZ } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";
import { ReviewLinkMode } from "@prisma/client";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/admin/send-review-link
 * Sends a review link to a past client via email or SMS and stamps the state
 * onto their Contact row. Authenticated via X-Admin-Secret header.
 * @param request - The incoming request.
 * @returns JSON with reviewUrl (and `existing: true` when the same link was
 * already issued earlier).
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
    };
    const { name, email, phone, mode = "email" } = body;

    if (!name?.trim()) {
      return errorResponse("Name is required.", 400);
    }
    if (mode === "email" && (!email?.trim() || !email.includes("@"))) {
      return errorResponse("Valid email is required.", 400);
    }

    const siteUrl = getSiteUrl();

    // Land the Contact first to identify the recipient.
    const normalisedEmail = mode === "email" ? email!.trim().toLowerCase() : null;
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
    // rather than rotating the token (so old emails keep working).
    if (contact.reviewLinkSentAt && contact.reviewToken) {
      const reviewUrl = `${siteUrl}/review?token=${contact.reviewToken}`;
      return NextResponse.json({ ok: true, reviewUrl, existing: true });
    }

    // Dedup against the booking auto-send to avoid doubling up via a different channel.
    if (normalisedEmail) {
      const existingBooking = await prisma.booking.findFirst({
        where: {
          email: { equals: normalisedEmail, mode: "insensitive" },
          reviewSentAt: { not: null },
        },
        select: { reviewToken: true },
      });
      if (existingBooking) {
        const reviewUrl = `${siteUrl}/review?token=${existingBooking.reviewToken}`;
        return NextResponse.json({ ok: true, reviewUrl, existing: true });
      }
    }

    // Ensure the contact carries a stable review token and stamp the send.
    const reviewToken = contact.reviewToken ?? randomUUID();
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        reviewToken,
        reviewLinkSentAt: new Date(),
        reviewLinkSentMode: mode === "email" ? ReviewLinkMode.email : ReviewLinkMode.sms,
      },
    });

    // Build the link and send the email
    const reviewUrl = `${siteUrl}/review?token=${reviewToken}`;

    if (mode === "sms") {
      return NextResponse.json({ ok: true, reviewUrl });
    }

    await sendPastClientReviewRequest({
      id: contact.id,
      name: name.trim(),
      email: normalisedEmail!,
      reviewToken,
    });

    return NextResponse.json({ ok: true, reviewUrl });
  } catch (error) {
    console.error("[admin/send-review-link] Error:", error);
    return errorResponse("Failed to send review link.", 500);
  }
}
