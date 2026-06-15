// src/app/api/reviews/route.ts
/**
 * @file route.ts
 * @description API routes for reviews with verification support.
 */

import { sendOwnerReviewNotification } from "@/features/reviews/lib/email";
import { reviewTextError } from "@/features/reviews/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { normalisePhone } from "@/shared/lib/normalise-phone";
import { prisma as prismaClient } from "@/shared/lib/prisma";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

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
 * (bookingId + reviewToken) or against a contact-level manual link
 * (contactId + reviewToken).
 * @param request - Incoming Next.js request containing review text, optional name fields, and optional verification fields.
 * @returns JSON response with ok flag and review id on success (201), or an error message on failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "reviews-post", 5, 60_000);
  if (limited) return limited;

  const prisma = prismaClient;
  try {
    // Parse and validate body
    const body = (await request.json()) as {
      text?: string;
      firstName?: string;
      lastName?: string;
      isAnonymous?: boolean;
      bookingId?: string;
      contactId?: string;
      reviewToken?: string;
      contactEmail?: string;
      contactPhone?: string;
    };

    const text = body.text?.trim() ?? "";
    const textErr = reviewTextError(text);
    if (textErr) return errorResponse(textErr, 400);

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
        // Auto-link to Contact by booking email - best effort, never fails the submission.
        try {
          const contact = await prisma.contact.findFirst({
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

    // Verify against a contact-level manual review link
    if (!verified && body.contactId && body.reviewToken) {
      const contact = await prisma.contact.findFirst({
        where: { id: body.contactId, reviewToken: body.reviewToken },
        select: { id: true, email: true, phone: true },
      });

      if (contact) {
        verified = true;
        customerRef = body.reviewToken;
        autoContactId = contact.id;

        // Fill blanks on the Contact from any details the customer typed,
        // never overwriting an existing value.
        const submittedEmail = body.contactEmail?.trim().toLowerCase() || null;
        const submittedPhone = body.contactPhone ? normalisePhone(body.contactPhone) : null;
        const contactUpdate: { email?: string; phone?: string; reviewLinkSubmittedAt: Date } = {
          reviewLinkSubmittedAt: new Date(),
        };
        if (!contact.email && submittedEmail) contactUpdate.email = submittedEmail;
        if (!contact.phone && submittedPhone) contactUpdate.phone = submittedPhone;
        await prisma.contact.update({ where: { id: contact.id }, data: contactUpdate });
      }
    }

    // Token-verified reviews auto-approve only when the operator opts in;
    // otherwise everything starts pending for manual approval.
    const { reviews: reviewSettings } = await getSettings();
    const status = verified && reviewSettings.autoApproveVerified ? "approved" : "pending";

    // Create the review
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
        status,
      },
    });

    // Trigger on-demand revalidation of review surfaces. An auto-approved review
    // should also appear on the home page (tag-cached), so bust that tag too.
    revalidatePath("/reviews");
    revalidatePath("/review");
    if (status === "approved") revalidateTag("reviews", {});

    // Notify the owner - fire-and-forget, never blocks the response
    void sendOwnerReviewNotification(review);

    return NextResponse.json({ ok: true, id: review.id, verified }, { status: 201 });
  } catch (error) {
    console.error("[reviews] POST error:", error);
    return errorResponse("Failed to submit review.", 500);
  }
}
