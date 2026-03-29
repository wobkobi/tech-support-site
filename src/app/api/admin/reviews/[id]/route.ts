// src/app/api/admin/reviews/[id]/route.ts
/**
 * @file route.ts
 * @description Admin API for approving, revoking, and deleting reviews.
 * Protected by ADMIN_SECRET via constant-time comparison.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isValidAdminToken, isAdminRequest } from "@/shared/lib/auth";
import { revalidateReviewPaths } from "@/features/reviews/lib/revalidate";

/**
 * PATCH /api/admin/reviews/[id]
 * Approves or revokes a review, or updates the linked contactId.
 * - When body contains { action: "approve" | "revoke", token } → moderation flow (token in body).
 *   On approve, automatically upserts a Contact record from the review's booking/review-request
 *   and links review.contactId. This is best-effort; failure does not block the approval.
 * - When body contains { contactId: string | null } → contact-link flow (token via X-Admin-Secret header).
 * @param request - Incoming request.
 * @param params - Route segment params wrapper.
 * @param params.params - Promise resolving to the route segment containing the review ID.
 * @returns JSON response.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const body = (await request.json()) as {
    action?: string;
    token?: string;
    contactId?: string | null;
  };

  // Contact-link flow: authenticated via X-Admin-Secret header.
  if ("contactId" in body) {
    if (!isAdminRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    try {
      await prisma.review.update({
        where: { id },
        data: { contactId: body.contactId ?? null },
      });
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.error(`[admin/reviews] PATCH contactId error for ${id}:`, error);
      return NextResponse.json({ error: "Failed to update review" }, { status: 500 });
    }
  }

  // Moderation flow: authenticated via token in request body.
  if (!isValidAdminToken(body.token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { action } = body;
  if (action !== "approve" && action !== "revoke") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const { id } = await params;

  try {
    // Fetch review before updating so we have source info for auto-link.
    const review = await prisma.review.findUnique({
      where: { id },
      select: {
        bookingId: true,
        customerRef: true,
        contactId: true,
        firstName: true,
        lastName: true,
      },
    });

    await prisma.review.update({
      where: { id },
      data: { status: action === "approve" ? "approved" : "pending" },
    });

    // Auto-link review to a Contact on approve (best-effort, non-fatal).
    if (action === "approve" && review && !review.contactId) {
      try {
        let email: string | null = null;
        let contactName: string | null = null;
        let contactPhone: string | null = null;

        if (review.bookingId) {
          const booking = await prisma.booking.findUnique({
            where: { id: review.bookingId },
            select: { email: true, name: true },
          });
          email = booking?.email ?? null;
          contactName = booking?.name ?? null;
        } else if (review.customerRef) {
          const rr = await prisma.reviewRequest.findFirst({
            where: { reviewToken: review.customerRef },
            select: { email: true, name: true, phone: true },
          });
          email = rr?.email ?? null;
          contactName = rr?.name ?? null;
          contactPhone = rr?.phone ?? null;
        }

        if (email) {
          const fallbackName =
            [review.firstName, review.lastName].filter(Boolean).join(" ") || "Unknown";
          let contact = await prisma.contact.findFirst({ where: { email } });
          if (!contact) {
            contact = await prisma.contact.create({
              data: {
                name: contactName ?? fallbackName,
                email,
                ...(contactPhone && { phone: contactPhone }),
              },
            });
          }
          await prisma.review.update({
            where: { id },
            data: { contactId: contact.id },
          });
        }
      } catch (err) {
        console.error(`[admin/reviews] Auto-link contact failed for review ${id}:`, err);
      }
    }

    // Trigger ISR revalidation so public pages update immediately
    revalidateReviewPaths();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[admin/reviews] PATCH error for ${id}:`, error);
    return NextResponse.json({ error: "Failed to update review" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/reviews/[id]
 * Permanently deletes a review.
 * @param request - Incoming request with ?token= query param.
 * @param params - Route segment params wrapper.
 * @param params.params - Promise resolving to the route segment containing the review ID.
 * @returns JSON response.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");

  if (!isValidAdminToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await prisma.review.delete({ where: { id } });

    // Trigger ISR revalidation so public pages update immediately
    revalidateReviewPaths();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[admin/reviews] DELETE error for ${id}:`, error);
    return NextResponse.json({ error: "Failed to delete review" }, { status: 500 });
  }
}
