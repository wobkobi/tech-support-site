// src/app/api/reviews/route.ts
/**
 * @file route.ts
 * @description API routes for reviews with verification support.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { sendOwnerReviewNotification } from "@/lib/email";

/**
 * GET /api/reviews
 * Returns all approved reviews ordered by most recent first.
 * @returns JSON response with a reviews array, or an empty array on error.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const reviews = await prisma.review.findMany({
      where: { status: "approved" },
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
 * Submits a new review. Optionally verifies the reviewer against a booking
 * or manual review request using bookingId/reviewRequestId and reviewToken.
 * @param request - Incoming Next.js request containing review text, optional name fields, and optional booking verification fields.
 * @returns JSON response with ok flag and review id on success (201), or an error message on failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      text?: string;
      firstName?: string;
      lastName?: string;
      isAnonymous?: boolean;
      bookingId?: string;
      reviewRequestId?: string;
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
    let customerRef = null;

    // Verify against a real booking
    if (body.bookingId && body.reviewToken) {
      const booking = await prisma.booking.findFirst({
        where: { id: body.bookingId, reviewToken: body.reviewToken },
      });

      if (booking) {
        verified = true;
        bookingId = booking.id;
        customerRef = booking.reviewToken;
        await prisma.booking.update({
          where: { id: booking.id },
          data: { reviewSubmittedAt: new Date() },
        });
      }
    }

    // Verify against a manual review request
    if (!verified && body.reviewRequestId && body.reviewToken) {
      const reviewRequest = await prisma.reviewRequest.findFirst({
        where: { id: body.reviewRequestId, reviewToken: body.reviewToken },
      });

      if (reviewRequest) {
        verified = true;
        customerRef = reviewRequest.reviewToken;
        await prisma.reviewRequest.update({
          where: { id: reviewRequest.id },
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
        customerRef,
        status: "pending", // All reviews start as pending
      },
    });

    // ✅ Trigger on-demand revalidation of review pages
    // Next users who visit /reviews or /review will see fresh data
    revalidatePath("/reviews");
    revalidatePath("/review");

    // Notify the owner - fire-and-forget, never blocks the response
    void sendOwnerReviewNotification(review);

    return NextResponse.json({ ok: true, id: review.id, verified }, { status: 201 });
  } catch (error) {
    console.error("[reviews] POST error:", error);
    return NextResponse.json({ error: "Failed to submit review." }, { status: 500 });
  }
}
