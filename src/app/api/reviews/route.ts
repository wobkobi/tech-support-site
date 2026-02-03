// src/app/api/reviews/route.ts
/**
 * @file route.ts
 * @description API routes for reviews.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/reviews
 * Returns approved reviews.
 * @returns JSON with reviews array.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const reviews = await prisma.review.findMany({
      where: { approved: true },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        text: true,
        firstName: true,
        lastName: true,
        isAnonymous: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ reviews });
  } catch (error) {
    console.error("[reviews] GET error:", error);
    return NextResponse.json({ reviews: [] }, { status: 500 });
  }
}

/**
 * POST /api/reviews
 * Submits a new review for approval.
 * @param request - Incoming request.
 * @returns JSON response.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      text?: string;
      firstName?: string;
      lastName?: string;
      isAnonymous?: boolean;
    };

    const text = body.text?.trim();
    if (!text || text.length < 10) {
      return NextResponse.json({ error: "Review must be at least 10 characters." }, { status: 400 });
    }
    if (text.length > 600) {
      return NextResponse.json({ error: "Review must be 600 characters or less." }, { status: 400 });
    }

    const firstName = body.firstName?.trim() || null;
    const lastName = body.lastName?.trim() || null;
    const isAnonymous = body.isAnonymous ?? false;

    if (!isAnonymous && !firstName) {
      return NextResponse.json(
        { error: "First name required unless posting anonymously." },
        { status: 400 },
      );
    }

    const review = await prisma.review.create({
      data: {
        text,
        firstName: isAnonymous ? null : firstName,
        lastName: isAnonymous ? null : lastName,
        isAnonymous,
        approved: false,
      },
    });

    return NextResponse.json({ ok: true, id: review.id }, { status: 201 });
  } catch (error) {
    console.error("[reviews] POST error:", error);
    return NextResponse.json({ error: "Failed to submit review." }, { status: 500 });
  }
}
