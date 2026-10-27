// src/app/api/reviews/[id]/route.ts
// PATCH /api/reviews/[id] - Allows a customer to edit their review (with valid
// customerRef), resets status to pending.

import { fillBlankContactDetails } from "@/features/reviews/lib/contact-details.server";
import { revalidateReviewPaths } from "@/features/reviews/lib/revalidate";
import { reviewTextError } from "@/features/reviews/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { normaliseEmailOrNull } from "@/shared/lib/normalise-email";
import { normaliseContactPhone } from "@/shared/lib/normalise-phone";
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
    // Same name rule as the create path, or the edit would show as "Unknown".
    const cleanFirst = typeof firstName === "string" ? firstName.trim() : "";
    const cleanLast = typeof lastName === "string" ? lastName.trim() : "";
    if (!isAnonymous && !cleanFirst) {
      return errorResponse("First name required unless posting anonymously.", 400);
    }

    // Find review and check customerRef
    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) {
      console.error("[PATCH] Not found: returning 404");
      return errorResponse("Review not found.", 404);
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
      return errorResponse("Unauthorized.", 403);
    }

    // Update review, reset status to pending
    const updated = await prisma.review.update({
      where: { id },
      data: {
        text: text.trim(),
        firstName: isAnonymous ? null : cleanFirst,
        lastName: isAnonymous ? null : cleanLast || null,
        isAnonymous: !!isAnonymous,
        status: "pending",
      },
    });

    // The edit flips the review back to pending, so it must drop off the public
    // marquee / reviews page immediately rather than after the 24h cache TTL.
    revalidateReviewPaths();

    const contactEmail = normaliseEmailOrNull(body.contactEmail);
    const contactPhone = normaliseContactPhone(body.contactPhone);
    if (updated.contactId) {
      await fillBlankContactDetails(updated.contactId, {
        email: contactEmail,
        phone: contactPhone,
      });
    }

    // Notify the owner - an edit resets the review to pending, dropping it off the public
    // page until re-approved. Awaited, not detached: Vercel freezes the instance once the
    // response is sent, and a detached rejection escapes this try/catch entirely.
    try {
      const { sendOwnerReviewNotification } = await import("@/features/reviews/lib/email");
      await sendOwnerReviewNotification({
        id: updated.id,
        text: updated.text,
        firstName: updated.firstName,
        lastName: updated.lastName,
        isAnonymous: updated.isAnonymous,
        verified: !!updated.verified,
        status: "pending",
        edited: true,
        contactEmail,
        contactPhone,
      });
    } catch (e) {
      console.warn("[PATCH] Failed to send owner notification after edit", e);
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("[reviews] PATCH error:", error);
    return errorResponse("Failed to update review.", 500);
  }
}
