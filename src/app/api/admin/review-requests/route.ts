// src/app/api/admin/review-requests/route.ts
/**
 * @file route.ts
 * @description Admin endpoint to create a ReviewRequest for a legacy review entry.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { toE164NZ, isValidPhone } from "@/shared/lib/normalize-phone";

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
     */
    async function upsertContact(
      contactEmail: string | null | undefined,
      contactName: string,
    ): Promise<void> {
      if (!contactEmail) return;
      try {
        const exists = await prisma.contact.findFirst({ where: { email: contactEmail } });
        if (!exists) {
          await prisma.contact.create({
            data: { name: contactName, email: contactEmail, phone: normalizedPhone || null },
          });
        }
      } catch {
        // best-effort
      }
    }

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
            name: name.trim(),
            email: email?.trim().toLowerCase() || null,
            phone: normalizedPhone || null,
          },
        });
        await upsertContact(email?.trim().toLowerCase(), name.trim());
        return NextResponse.json({ ok: true, id: existing.id });
      }

      const reviewRequest = await prisma.reviewRequest.create({
        data: {
          reviewToken: customerRef,
          name: name.trim(),
          email: email?.trim().toLowerCase() || null,
          phone: normalizedPhone || null,
          reviewSubmittedAt: new Date(),
        },
        select: { id: true, reviewToken: true },
      });

      await upsertContact(email?.trim().toLowerCase(), name.trim());
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
        name: name.trim(),
        email: email?.trim().toLowerCase() || null,
        phone: normalizedPhone || null,
        reviewSubmittedAt: new Date(),
      },
      select: { id: true, reviewToken: true },
    });

    await prisma.review.update({
      where: { id: reviewId },
      data: { customerRef: reviewRequest.reviewToken },
    });

    await upsertContact(email?.trim().toLowerCase(), name.trim());
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
