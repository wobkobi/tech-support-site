// src/app/api/admin/reviews/route.ts
/**
 * @file route.ts
 * @description Admin API for manually creating reviews (for past clients).
 */

import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Validates the token against ADMIN_SECRET using constant-time comparison.
 * @param token - Token to validate.
 * @returns True if valid.
 */
function isValidToken(token: string | null): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !token) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

/**
 * POST /api/admin/reviews
 * Creates a new review, pre-approved. Used by admin to add past client reviews.
 * @param request - Incoming request.
 * @returns JSON with the created review.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      token?: string;
      text?: string;
      firstName?: string;
      lastName?: string;
      isAnonymous?: boolean;
    };

    if (!isValidToken(body.token ?? null)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const text = body.text?.trim();
    if (!text || text.length < 10) {
      return NextResponse.json(
        { error: "Review must be at least 10 characters." },
        { status: 400 },
      );
    }
    if (text.length > 600) {
      return NextResponse.json(
        { error: "Review must be 600 characters or less." },
        { status: 400 },
      );
    }

    const isAnonymous = body.isAnonymous ?? false;
    const firstName = isAnonymous ? null : body.firstName?.trim() || null;
    const lastName = isAnonymous ? null : body.lastName?.trim() || null;

    const review = await prisma.review.create({
      data: {
        text,
        firstName,
        lastName,
        isAnonymous,
        verified: false,
        status: "approved",
      },
      select: {
        id: true,
        text: true,
        firstName: true,
        lastName: true,
        isAnonymous: true,
        verified: true,
        status: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ ok: true, review }, { status: 201 });
  } catch (error) {
    console.error("[admin/reviews] POST error:", error);
    return NextResponse.json({ error: "Failed to create review." }, { status: 500 });
  }
}
