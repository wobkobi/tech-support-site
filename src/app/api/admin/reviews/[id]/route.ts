// src/app/api/admin/reviews/[id]/route.ts
/**
 * @description Admin API for approving, revoking, and deleting reviews.
 * Protected by ADMIN_SECRET via constant-time comparison.
 */

import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";
import { revalidateReviewPaths } from "@/features/reviews/lib/revalidate";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * PATCH /api/admin/reviews/[id] - admin-auth gated.
 * `{ action: "approve" | "revoke" }` moderates; approve also best-effort
 * upserts + links a Contact from the booking/review-request (never blocking).
 * `{ contactId: string | null }` updates the link directly.
 * @param request - Incoming request.
 * @param params - Route segment params wrapper.
 * @param params.params - Promise resolving to the route segment containing the review ID.
 * @returns JSON response.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = (await request.json()) as {
    action?: string;
    contactId?: string | null;
  };

  // Contact-link flow.
  if ("contactId" in body) {
    const { id } = await params;

    try {
      await prisma.review.update({
        where: { id },
        data: { contactId: body.contactId ?? null },
      });
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.error(`[admin/reviews] PATCH contactId error for ${id}:`, error);
      return errorResponse("Failed to update review", 500);
    }
  }

  const { action } = body;
  if (action !== "approve" && action !== "revoke") {
    return errorResponse("Invalid action", 400);
  }

  const { id } = await params;

  try {
    // Fetch the review before updating to keep source info for the auto-link.
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
        let directContactId: string | null = null;

        if (review.bookingId) {
          const booking = await prisma.booking.findUnique({
            where: { id: review.bookingId },
            select: { email: true, name: true },
          });
          email = booking?.email ?? null;
          contactName = booking?.name ?? null;
        } else if (review.customerRef) {
          // Standalone reviews carry the token from the Contact magic link;
          // look the contact up directly rather than going through email.
          const linkedContact = await prisma.contact.findFirst({
            where: { reviewToken: review.customerRef },
            select: { id: true },
          });
          directContactId = linkedContact?.id ?? null;
        }

        if (directContactId) {
          await prisma.review.update({
            where: { id },
            data: { contactId: directContactId },
          });
        } else if (email) {
          const fallbackName =
            [review.firstName, review.lastName].filter(Boolean).join(" ") || "Unknown";
          const { contact } = await findOrCreateContactByEmail(email, {
            name: contactName ?? fallbackName,
          });
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
    return errorResponse("Failed to update review", 500);
  }
}

/**
 * DELETE /api/admin/reviews/[id]
 * Permanently deletes a review. Authenticated via X-Admin-Secret header.
 * @param request - Incoming request.
 * @param params - Route segment params wrapper.
 * @param params.params - Promise resolving to the route segment containing the review ID.
 * @returns JSON response.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;

  try {
    await prisma.review.delete({ where: { id } });

    // Trigger ISR revalidation so public pages update immediately
    revalidateReviewPaths();

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[admin/reviews] DELETE error for ${id}:`, error);
    return errorResponse("Failed to delete review", 500);
  }
}
