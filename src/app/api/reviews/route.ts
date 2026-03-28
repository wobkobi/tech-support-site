// src/app/api/reviews/route.ts
/**
 * @file route.ts
 * @description API routes for reviews with verification support.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma as prismaClient } from "@/shared/lib/prisma";
import { sendOwnerReviewNotification } from "@/features/reviews/lib/email";
import { normalizePhone } from "@/shared/lib/normalize-phone";
import { reviewTextError } from "@/features/reviews/lib/validation";

/**
 * Factory for reviews API handlers, allows dependency injection of Prisma client.
 * @param prisma - Prisma client instance to use for DB operations.
 * @returns Handlers for GET (and optionally POST).
 */
export function createReviewsHandlers(prisma = prismaClient): {
  GET: () => Promise<NextResponse>;
} {
  return {
    /**
     * Handles GET requests for reviews.
     * @returns JSON response with approved reviews or error.
     */
    async GET(): Promise<NextResponse> {
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
    },
    // ...existing POST handler will be moved below
  };
}

// Default export for Next.js API route
export const GET = createReviewsHandlers().GET;

/**
 * POST /api/reviews
 * Submits a new review. Optionally verifies the reviewer against a booking
 * or manual review request using bookingId/reviewRequestId and reviewToken.
 * @param request - Incoming Next.js request containing review text, optional name fields, and optional booking verification fields.
 * @returns JSON response with ok flag and review id on success (201), or an error message on failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const prisma = prismaClient;
  try {
    const body = (await request.json()) as {
      text?: string;
      firstName?: string;
      lastName?: string;
      isAnonymous?: boolean;
      bookingId?: string;
      reviewRequestId?: string;
      reviewToken?: string;
      contactEmail?: string;
      contactPhone?: string;
    };

    const text = body.text?.trim() ?? "";
    const textErr = reviewTextError(text);
    if (textErr) return NextResponse.json({ error: textErr }, { status: 400 });

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
    let autoContactId: string | null = null;

    // Verify against a real booking
    if (body.bookingId && body.reviewToken) {
      const booking = await prisma.booking.findFirst({
        where: { id: body.bookingId, reviewToken: body.reviewToken },
      });

      if (booking) {
        verified = true;
        bookingId = booking.id;
        customerRef = booking.reviewToken;
        // Auto-link to Contact by booking email — best effort, never fails the submission.
        try {
          const contact = await prisma.contact.findUnique({
            where: { email: booking.email.toLowerCase() },
            select: { id: true },
          });
          if (contact) autoContactId = contact.id;
        } catch {
          // best-effort
        }
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
        // Auto-link to Contact by ReviewRequest email — best effort, never fails the submission.
        if (reviewRequest.email) {
          try {
            const contact = await prisma.contact.findUnique({
              where: { email: reviewRequest.email.trim().toLowerCase() },
              select: { id: true },
            });
            if (contact) autoContactId = contact.id;
          } catch {
            // best-effort
          }
        }
        // Store any contact details the customer provided (only fill blanks, never overwrite)
        const contactEmail = body.contactEmail?.trim().toLowerCase() || null;
        const contactPhone = body.contactPhone ? normalizePhone(body.contactPhone) : null;
        await prisma.reviewRequest.update({
          where: { id: reviewRequest.id },
          data: {
            reviewSubmittedAt: new Date(),
            email: reviewRequest.email ?? contactEmail,
            phone: reviewRequest.phone ?? contactPhone,
          },
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
        contactId: autoContactId,
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
