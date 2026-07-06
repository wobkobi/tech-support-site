// src/app/api/reviews/[id]/route.ts
/**
 * @description PATCH /api/reviews/[id] - Allows a customer to edit their review (with valid customerRef), resets status to pending.
 */

import { revalidateReviewPaths } from "@/features/reviews/lib/revalidate";
import { reviewTextError } from "@/features/reviews/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { prisma } from "@/shared/lib/prisma";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/**
 * PATCH /api/reviews/[id] - Allows a customer to edit their review.
 * @param request - The incoming request with review data and customerRef.
 * @param root0 - Route context.
 * @param root0.params - Resolved route params containing the review ID.
 * @returns JSON response indicating success or failure.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "review-edit", 5, 60_000);
  if (limited) return limited;

  try {
    const { id } = await params;
    const body = await request.json();
    const { text, firstName, lastName, isAnonymous, customerRef } = body;

    // Same 10-1000 char rule as the create path (reviewTextError), so a review
    // that was accepted on submit can always be edited.
    const textErr = reviewTextError(text);
    if (textErr) return errorResponse(textErr, 400);

    // Find review and check customerRef
    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) {
      console.error("[PATCH] Not found: returning 404");
      return new NextResponse(JSON.stringify({ error: "Review not found." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Authorised when the supplied ref matches the review's stored ref, OR when
    // it is one of the linked contact's tokens (primary or merge-inherited alt)
    // - a person editing via a different link of theirs is still the same person.
    const directMatch = !!review.customerRef && review.customerRef === customerRef;
    let contactTokenMatch = false;
    if (!directMatch && review.contactId && typeof customerRef === "string" && customerRef) {
      const owner = await prisma.contact.findFirst({
        where: {
          id: review.contactId,
          OR: [{ reviewToken: customerRef }, { altReviewTokens: { has: customerRef } }],
        },
        select: { id: true },
      });
      contactTokenMatch = !!owner;
    }
    if (!directMatch && !contactTokenMatch) {
      console.error("[PATCH] Unauthorized: returning 403");
      return new NextResponse(JSON.stringify({ error: "Unauthorized." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Update review, reset status to pending
    const updated = await prisma.review.update({
      where: { id },
      data: {
        text: text.trim(),
        firstName: isAnonymous ? null : firstName?.trim() || null,
        lastName: isAnonymous ? null : lastName?.trim() || null,
        isAnonymous: !!isAnonymous,
        status: "pending",
      },
    });

    // The edit flips the review back to pending, so it must drop off the public
    // marquee / reviews page immediately rather than after the 24h cache TTL.
    revalidateReviewPaths();

    // Fire-and-forget: notify owner of edit
    try {
      // Only send if not anonymous or text changed
      // (optional: always send for audit)
      const {
        id: reviewId,
        text: reviewText,
        firstName: fn,
        lastName: ln,
        isAnonymous: anon,
        verified,
      } = updated;
      void import("@/features/reviews/lib/email").then((m) =>
        m.sendOwnerReviewNotification({
          id: reviewId,
          text: reviewText,
          firstName: fn,
          lastName: ln,
          isAnonymous: anon,
          verified: !!verified,
        }),
      );
    } catch (e) {
      console.warn("[PATCH] Failed to send owner notification after edit", e);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("[reviews] PATCH error:", error);
    return errorResponse("Failed to update review.", 500);
  }
}
