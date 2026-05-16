// src/app/api/admin/send-review-link/route.ts
/**
 * @file route.ts
 * @description Admin endpoint to send a review request link to a past client.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { sendPastClientReviewRequest } from "@/features/reviews/lib/email";
import { isAdminRequest } from "@/shared/lib/auth";
import { toE164NZ, isValidPhone } from "@/shared/lib/normalize-phone";

/**
 * POST /api/admin/send-review-link
 * Creates a minimal booking record and sends a review request email to a past client.
 * Authenticated via X-Admin-Secret header.
 * @param request - The incoming request.
 * @returns JSON response indicating success or failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
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

    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz").replace(
      /\/$/,
      "",
    );

    // Deduplication for SMS: if this phone already received a link, return the existing one
    if (mode === "sms" && phone) {
      const normalizedPhone = toE164NZ(phone);
      if (!isValidPhone(normalizedPhone)) {
        return NextResponse.json({ ok: false, error: "Invalid phone number." }, { status: 400 });
      }
      const existingRequest = await prisma.reviewRequest.findFirst({
        where: { phone: normalizedPhone },
        select: { reviewToken: true },
      });
      if (existingRequest) {
        const reviewUrl = `${siteUrl}/review?token=${existingRequest.reviewToken}`;
        return NextResponse.json({ ok: true, reviewUrl, existing: true });
      }
    }

    // Deduplication for email: if this email already received a link, return the existing one
    if (mode === "email" && email) {
      const normalizedEmail = email.trim().toLowerCase();
      const existingRequest = await prisma.reviewRequest.findFirst({
        where: { email: normalizedEmail },
        select: { reviewToken: true },
      });
      if (existingRequest) {
        const reviewUrl = `${siteUrl}/review?token=${existingRequest.reviewToken}`;
        return NextResponse.json({ ok: true, reviewUrl, existing: true });
      }
      const existingBooking = await prisma.booking.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: "insensitive" },
          reviewSentAt: { not: null },
        },
        select: { reviewToken: true },
      });
      if (existingBooking) {
        const reviewUrl = `${siteUrl}/review?token=${existingBooking.reviewToken}`;
        return NextResponse.json({ ok: true, reviewUrl, existing: true });
      }
    }

    const reviewRequest = await prisma.reviewRequest.create({
      data: {
        name: name.trim(),
        email: mode === "email" ? email!.trim().toLowerCase() : null,
        phone: mode === "sms" && phone ? toE164NZ(phone) : null,
      },
    });

    // Upsert a Contact record - best effort, never blocks.
    if (mode === "email" && reviewRequest.email) {
      try {
        const exists = await prisma.contact.findFirst({ where: { email: reviewRequest.email } });
        if (!exists) {
          await prisma.contact.create({
            data: { name: name.trim(), email: reviewRequest.email, phone: null },
          });
        }
      } catch {
        // best-effort
      }
    } else if (mode === "sms" && reviewRequest.phone) {
      try {
        const exists = await prisma.contact.findFirst({ where: { phone: reviewRequest.phone } });
        if (!exists) {
          await prisma.contact.create({
            data: { name: name.trim(), email: null, phone: reviewRequest.phone },
          });
        }
      } catch {
        // best-effort
      }
    }

    const reviewUrl = `${siteUrl}/review?token=${reviewRequest.reviewToken}`;

    if (mode === "sms") {
      return NextResponse.json({ ok: true, reviewUrl });
    }

    await sendPastClientReviewRequest({
      id: reviewRequest.id,
      name: name.trim(),
      email: email!.trim().toLowerCase(),
      reviewToken: reviewRequest.reviewToken,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin/send-review-link] Error:", error);
    return NextResponse.json({ ok: false, error: "Failed to send review link." }, { status: 500 });
  }
}
