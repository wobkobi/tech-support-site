// PATCH /api/reviews/[id]
// Allows a customer to edit their review (with valid customerRef), resets status to pending
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * PATCH /api/reviews/[id] - Allows a customer to edit their review.
 * @param request - The incoming request with review data and customerRef.
 * @param root0 - Route params wrapper.
 * @param root0.params - Route segment params.
 * @param root0.params.id - The review ID.
 * @returns JSON response indicating success or failure.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const { id } = params;
    const body = await request.json();
    const { text, firstName, lastName, isAnonymous, customerRef } = body;

    if (!text || text.trim().length < 10) {
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

    // Find review and check customerRef
    const review = await prisma.review.findUnique({ where: { id } });
    if (!review) {
      console.error("[PATCH] Not found: returning 404");
      return new NextResponse(JSON.stringify({ error: "Review not found." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!review.customerRef || review.customerRef !== customerRef) {
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
      void import("@/lib/email").then((m) =>
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
    return NextResponse.json({ error: "Failed to update review." }, { status: 500 });
  }
}
