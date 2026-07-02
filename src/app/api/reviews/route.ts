// src/app/api/reviews/route.ts
/**
 * @description API routes for reviews with verification support.
 */

import { sendOwnerReviewNotification } from "@/features/reviews/lib/email";
import { reviewTextError } from "@/features/reviews/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { normaliseContactPhone } from "@/shared/lib/normalise-phone";
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
        // One review per booking: a used link is an edit flow (PATCH), so a
        // second POST for the same booking is a duplicate - refuse it.
        const existing = await prisma.review.findFirst({
          where: { bookingId: booking.id },
          select: { id: true },
        });
        if (existing) {
          return errorResponse(
            "You've already left a review - open your review link to edit it.",
            409,
          );
        }
        verified = true;
        bookingId = booking.id;
        customerRef = booking.reviewToken;
        // Auto-link to Contact by booking email - best effort, never fails the
        // submission. Case-insensitive and skips soft-deleted contacts; when no
        // live contact is found the review keeps its bookingId + customerRef so
        // matchReviewsToContacts can link it later.
        try {
          const bookingEmail = booking.email.toLowerCase();
          const contact = await prisma.contact.findFirst({
            where: {
              OR: [
                { email: { equals: bookingEmail, mode: "insensitive" } },
                { altEmails: { has: bookingEmail } },
              ],
              deletedAt: null,
            },
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
      } else {
        // Token supplied but the booking is gone - keep the token so the review
        // is still identifiable, and log rather than silently dropping it.
        customerRef = body.reviewToken;
        console.warn(
          `[reviews] booking-token submission matched no booking (bookingId=${body.bookingId}); review kept with customerRef.`,
        );
      }
    }

    // Verify against a contact-level manual review link. The token may be the
    // contact's primary reviewToken or one inherited from a merged-away
    // contact (altReviewTokens) - both prove the same person.
    if (!verified && body.contactId && body.reviewToken) {
      const contact = await prisma.contact.findFirst({
        where: {
          id: body.contactId,
          OR: [{ reviewToken: body.reviewToken }, { altReviewTokens: { has: body.reviewToken } }],
        },
        select: { id: true, email: true, phone: true, deletedAt: true },
      });

      if (contact && !contact.deletedAt) {
        // One review per contact: a used link is an edit flow (PATCH), so a
        // second POST for the same person is a duplicate - refuse it.
        const existing = await prisma.review.findFirst({
          where: { contactId: contact.id },
          select: { id: true },
        });
        if (existing) {
          return errorResponse(
            "You've already left a review - open your review link to edit it.",
            409,
          );
        }
        verified = true;
        customerRef = body.reviewToken;
        autoContactId = contact.id;

        // Fill blanks on the Contact from any details the customer typed,
        // never overwriting an existing value.
        const submittedEmail = body.contactEmail?.trim().toLowerCase() || null;
        const submittedPhone = normaliseContactPhone(body.contactPhone);
        const contactUpdate: { email?: string; phone?: string; reviewLinkSubmittedAt: Date } = {
          reviewLinkSubmittedAt: new Date(),
        };
        if (!contact.email && submittedEmail) contactUpdate.email = submittedEmail;
        if (!contact.phone && submittedPhone) contactUpdate.phone = submittedPhone;
        await prisma.contact.update({ where: { id: contact.id }, data: contactUpdate });
      } else if (contact) {
        // The token is valid but the contact was soft-deleted/merged away. Keep
        // the token (so the review re-links if the contact returns) but don't
        // mark it verified or link it to a dead row.
        customerRef = body.reviewToken;
        console.warn(
          `[reviews] contact-token submission matched a soft-deleted contact (contactId=${body.contactId}); review kept with customerRef for later re-link.`,
        );
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
