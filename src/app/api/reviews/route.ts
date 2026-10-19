// src/app/api/reviews/route.ts
// API routes for reviews with verification support.

import { parseObjectId, parseString } from "@/features/business/lib/validation";
import { sendOwnerPush } from "@/features/notifications/lib/push";
import { sendOwnerReviewNotification } from "@/features/reviews/lib/email";
import { revalidateReviewPaths } from "@/features/reviews/lib/revalidate";
import { reviewTextError } from "@/features/reviews/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { normaliseEmailOrNull } from "@/shared/lib/normalise-email";
import { normaliseContactPhone } from "@/shared/lib/normalise-phone";
import { prisma as prismaClient } from "@/shared/lib/prisma";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { getSettings } from "@/shared/lib/settings/get-settings";
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
  };
}

// Default export for Next.js API route
export const GET = createReviewsHandlers().GET;

/**
 * POST /api/reviews - submit a review, optionally verified by a booking or contact token.
 * @param request - Review text, optional names, and optional verification fields.
 * @returns `{ ok, id, verified, status }` (201), or an error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "reviews-post", 5, 60_000);
  if (limited) return limited;

  const prisma = prismaClient;
  try {
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

    // Validate before any reaches a `where`: Prisma accepts a filter object in place of
    // a scalar, which would let a caller match a booking without its token.
    const claimedToken = parseString(body.reviewToken);
    const claimedBookingId = parseObjectId(body.bookingId);
    const claimedContactId = parseObjectId(body.contactId);

    // Verify against a real booking
    if (claimedBookingId && claimedToken) {
      const booking = await prisma.booking.findFirst({
        where: { id: claimedBookingId, reviewToken: claimedToken },
      });

      if (booking) {
        // One review per booking; edits go through PATCH.
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
        // Best-effort link to a live Contact by email; unmatched reviews are linked
        // later by matchReviewsToContacts.
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
        // Booking gone: keep the token so the review stays identifiable.
        customerRef = claimedToken;
        console.warn(
          `[reviews] booking-token submission matched no booking (bookingId=${claimedBookingId}); review kept with customerRef.`,
        );
      }
    }

    // Contact-level link: the token may be primary or inherited from a merge (altReviewTokens).
    if (!verified && claimedContactId && claimedToken) {
      const contact = await prisma.contact.findFirst({
        where: {
          id: claimedContactId,
          OR: [{ reviewToken: claimedToken }, { altReviewTokens: { has: claimedToken } }],
        },
        select: { id: true, email: true, phone: true, deletedAt: true },
      });

      if (contact && !contact.deletedAt) {
        // One review per contact; edits go through PATCH.
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
        customerRef = claimedToken;
        autoContactId = contact.id;

        // Fill blank Contact fields only; never overwrite.
        const submittedEmail = normaliseEmailOrNull(body.contactEmail);
        const submittedPhone = normaliseContactPhone(body.contactPhone);
        const contactUpdate: { email?: string; phone?: string; reviewLinkSubmittedAt: Date } = {
          reviewLinkSubmittedAt: new Date(),
        };
        if (!contact.email && submittedEmail) contactUpdate.email = submittedEmail;
        if (!contact.phone && submittedPhone) contactUpdate.phone = submittedPhone;
        await prisma.contact.update({ where: { id: contact.id }, data: contactUpdate });
      } else if (contact) {
        // Contact soft-deleted: keep the token for re-linking, but not verified.
        customerRef = claimedToken;
        console.warn(
          `[reviews] contact-token submission matched a soft-deleted contact (contactId=${claimedContactId}); review kept with customerRef for later re-link.`,
        );
      }
    }

    // Verified reviews auto-approve only when the operator opts in.
    const { reviews: reviewSettings, comms } = await getSettings();
    const status = verified && reviewSettings.autoApproveVerified ? "approved" : "pending";

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

    // Shared helper covers every review surface, including the home-page marquee.
    revalidateReviewPaths();

    // Awaited: Vercel freezes the instance after the response. Swallows its own errors.
    await sendOwnerReviewNotification(review);

    if (comms.pushOnReview) {
      await sendOwnerPush({
        title: "New review",
        // Reviews carry no rating field, so report approval state - never stars.
        body: `${review.firstName ?? "Someone"} - ${
          status === "approved" ? "published" : "waiting on approval"
        }`,
        url: "/admin/reviews",
        tag: `review-${review.id}`,
      });
    }

    // `status` tells the thank-you screen whether the review is live yet.
    return NextResponse.json({ ok: true, id: review.id, verified, status }, { status: 201 });
  } catch (error) {
    console.error("[reviews] POST error:", error);
    return errorResponse("Failed to submit review.", 500);
  }
}
