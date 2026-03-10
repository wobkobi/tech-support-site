// src/app/api/admin/review-requests/route.ts
/**
 * @file route.ts
 * @description Admin endpoint to create a ReviewRequest for a legacy review entry.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isValidAdminToken } from "@/shared/lib/auth";
import { toE164NZ, isValidPhone } from "@/shared/lib/normalize-phone";

/**
 * POST /api/admin/review-requests
 * Creates a ReviewRequest for a legacy review (using its existing customerRef as reviewToken).
 * If a ReviewRequest with that token already exists, returns its id.
 * @param request - The incoming request.
 * @returns JSON response with the ReviewRequest id, or an error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      token?: string;
      customerRef?: string;
      reviewId?: string;
      name?: string;
      email?: string;
      phone?: string;
    };
    const { token, reviewId, name, email, phone } = body;
    // Treat empty-string customerRef the same as absent (old MongoDB docs may have "" stored)
    const customerRef = body.customerRef || undefined;

    if (!isValidAdminToken(token ?? null)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

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
