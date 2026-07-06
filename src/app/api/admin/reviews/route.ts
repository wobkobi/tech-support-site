// src/app/api/admin/reviews/route.ts
/**
 * @description Admin API for manually creating reviews (for past clients).
 */

import { revalidateReviewPaths } from "@/features/reviews/lib/revalidate";
import { reviewTextError } from "@/features/reviews/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/reviews
 * Creates a new pre-approved review (operator path for past client reviews).
 * Authenticated via X-Admin-Secret header.
 * @param request - Incoming request.
 * @returns JSON with the created review.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const body = (await request.json()) as {
      text?: string;
      firstName?: string;
      lastName?: string;
      isAnonymous?: boolean;
    };

    const text = body.text?.trim() ?? "";
    const textErr = reviewTextError(text);
    if (textErr) return errorResponse(textErr, 400);

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

    // Surface the newly-approved review on the public marquee / reviews page
    // now, not after the 24h cache TTL.
    revalidateReviewPaths();

    return NextResponse.json({ ok: true, review }, { status: 201 });
  } catch (error) {
    console.error("[admin/reviews] POST error:", error);
    return errorResponse("Failed to create review.", 500);
  }
}
