// src/app/api/admin/send-review-link/route.ts
/**
 * @file route.ts
 * @description Admin endpoint to send a review request link to a past client.
 * Lands a Contact (creating one if needed), ensures Contact.reviewToken is set,
 * stamps Contact.reviewLinkSentAt, then sends the email/SMS. The standalone
 * ReviewRequest model was retired; all send-state lives on Contact now.
 */

import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { ReviewLinkMode } from "@prisma/client";
import { sendPastClientReviewRequest } from "@/features/reviews/lib/email";
import { isAdminRequest } from "@/shared/lib/auth";
import { getSiteUrl } from "@/shared/lib/site-url";
import { toE164NZ, isValidPhone } from "@/shared/lib/normalise-phone";
import {
  findOrCreateContactByEmail,
  findOrCreateContactByPhone,
} from "@/features/contacts/lib/find-or-create";

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
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      name?: string;
      email?: string;
      phone?: string;
      mode?: "email" | "sms";
    };
    const { name, email, phone, mode = "email" } = body;

    if (!name?.trim()) {
      return NextResponse.json({ ok: false, error: "Name is required." }, { status: 400 });
    }
    if (mode === "email" && (!email?.trim() || !email.includes("@"))) {
      return NextResponse.json({ ok: false, error: "Valid email is required." }, { status: 400 });
    }

    const siteUrl = getSiteUrl();

    // Land the Contact first so we know who we're talking to.
    const normalisedEmail = mode === "email" ? email!.trim().toLowerCase() : null;
    let normalisedPhone: string | null = null;
    if (mode === "sms") {
      if (!phone) {
        return NextResponse.json({ ok: false, error: "Phone is required." }, { status: 400 });
      }
      normalisedPhone = toE164NZ(phone);
      if (!isValidPhone(normalisedPhone)) {
        return NextResponse.json({ ok: false, error: "Invalid phone number." }, { status: 400 });
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

    // Dedup against the booking auto-send so we don't double-up via a different channel.
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
    return NextResponse.json({ ok: false, error: "Failed to send review link." }, { status: 500 });
  }
}
