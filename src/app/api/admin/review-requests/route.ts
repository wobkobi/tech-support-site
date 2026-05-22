// src/app/api/admin/review-requests/route.ts
/**
 * @file route.ts
 * @description Admin endpoint to create a ReviewRequest for a legacy review entry.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { toE164NZ, isValidPhone } from "@/shared/lib/normalise-phone";
import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";

/**
 * POST /api/admin/review-requests
 * Creates a ReviewRequest for a legacy review (using its existing customerRef as reviewToken).
 * If a ReviewRequest with that token already exists, returns its id.
 * Authenticated via X-Admin-Secret header.
 * @param request - The incoming request.
 * @returns JSON response with the ReviewRequest id, or an error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      customerRef?: string;
      reviewId?: string;
      name?: string;
      email?: string;
      phone?: string;
    };
    const { reviewId, name, email, phone } = body;
    // Treat empty-string customerRef the same as absent (old MongoDB docs may have "" stored)
    const customerRef = body.customerRef || undefined;

    if (!name?.trim()) {
      return NextResponse.json({ ok: false, error: "Name is required." }, { status: 400 });
    }

    if (!customerRef && !reviewId) {
      return NextResponse.json(
        { ok: false, error: "customerRef or reviewId is required." },
        { status: 400 },
      );
    }

    const normalizedPhone = phone ? toE164NZ(phone) : "";
    if (!isValidPhone(normalizedPhone)) {
      return NextResponse.json({ ok: false, error: "Invalid phone number." }, { status: 400 });
    }

    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz").replace(
      /\/$/,
      "",
    );

    /**
     * Upserts a Contact for a given email - best effort, never blocks the response.
     * @param contactEmail - Normalised email address.
     * @param contactName - Contact name from the ReviewRequest.
     * @returns The contact id, or null if no email or the upsert failed.
     */
    async function upsertContact(
      contactEmail: string | null | undefined,
      contactName: string,
    ): Promise<string | null> {
      if (!contactEmail) return null;
      try {
        const { contact } = await findOrCreateContactByEmail(contactEmail, {
          name: contactName,
          phone: normalizedPhone || null,
        });
        return contact.id;
      } catch {
        return null;
      }
    }

    const normalisedEmail = email?.trim().toLowerCase() || null;
    const contactId = await upsertContact(normalisedEmail, name.trim());

    if (customerRef) {
      // Legacy review with existing token - create or update ReviewRequest with that token
      const existing = await prisma.reviewRequest.findUnique({
        where: { reviewToken: customerRef },
        select: { id: true },
      });
      if (existing) {
        await prisma.reviewRequest.update({
          where: { id: existing.id },
          data: {
            contactId,
            name: name.trim(),
            email: normalisedEmail,
            phone: normalizedPhone || null,
          },
        });
        return NextResponse.json({ ok: true, id: existing.id });
      }

      const reviewRequest = await prisma.reviewRequest.create({
        data: {
          contactId,
          reviewToken: customerRef,
          name: name.trim(),
          email: normalisedEmail,
          phone: normalizedPhone || null,
          reviewSubmittedAt: new Date(),
        },
        select: { id: true, reviewToken: true },
      });

      return NextResponse.json({
        ok: true,
        id: reviewRequest.id,
        token: reviewRequest.reviewToken,
        reviewUrl: `${siteUrl}/review?token=${reviewRequest.reviewToken}`,
      });
    }

    // Tokenless legacy review - generate a fresh token, create ReviewRequest,
    // and back-link the original Review record so it no longer appears as tokenless.
    const reviewRequest = await prisma.reviewRequest.create({
      data: {
        contactId,
        name: name.trim(),
        email: normalisedEmail,
        phone: normalizedPhone || null,
        reviewSubmittedAt: new Date(),
      },
      select: { id: true, reviewToken: true },
    });

    await prisma.review.update({
      where: { id: reviewId },
      data: { customerRef: reviewRequest.reviewToken },
    });
    return NextResponse.json({
      ok: true,
      id: reviewRequest.id,
      token: reviewRequest.reviewToken,
      reviewUrl: `${siteUrl}/review?token=${reviewRequest.reviewToken}`,
    });
  } catch (error) {
    console.error("[admin/review-requests/POST] Error:", error);
    return NextResponse.json({ ok: false, error: "Failed to create." }, { status: 500 });
  }
}
