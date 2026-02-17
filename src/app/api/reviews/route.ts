// src/app/api/reviews/route.ts
/**
 * @file route.ts
 * @description API routes for reviews with verification support.
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
        verified: true,
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
 * Submits a new review (verified or public).
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
      bookingId?: string;
      reviewToken?: string;
    };

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

    const firstName = body.firstName?.trim() || null;
    const lastName = body.lastName?.trim() || null;
    const isAnonymous = body.isAnonymous ?? false;

    if (!isAnonymous && !firstName) {
      return NextResponse.json(
        { error: "First name required unless posting anonymously." },
        { status: 400 },
      );
    }

    let verified = false;
    let bookingId = null;

    // Check if this is a verified review from a booking
    if (body.bookingId && body.reviewToken) {
      const booking = await prisma.booking.findFirst({
        where: {
          id: body.bookingId,
          reviewToken: body.reviewToken,
        },
      });

      if (booking) {
        // Valid token - mark as verified
        verified = true;
        bookingId = booking.id;

        // Mark booking as reviewed
        await prisma.booking.update({
          where: { id: booking.id },
          data: { reviewSubmittedAt: new Date() },
        });
      }
    }

    const review = await prisma.review.create({
      data: {
        text,
        firstName: isAnonymous ? null : firstName,
        lastName: isAnonymous ? null : lastName,
        isAnonymous,
        verified,
        bookingId,
        approved: verified, // Auto-approve verified reviews
      },
    });

    return NextResponse.json({ ok: true, id: review.id, verified }, { status: 201 });
  } catch (error) {
    console.error("[reviews] POST error:", error);
    return NextResponse.json({ error: "Failed to submit review." }, { status: 500 });
  }
}
