// src/app/api/admin/bookings/[id]/resend-review/route.ts
// Admin API to manually (re)send the review ask for a booking.

import { findOrCreateContactByEmail } from "@/features/contacts/lib/find-or-create";
import { sendReviewAsk } from "@/features/reviews/lib/email-review-ask";
import { reviewAskBlockedBy } from "@/features/reviews/lib/review-ask-opt-out";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/bookings/[id]/resend-review
 * Sends (or resends) a booking's review ask, ensuring a Contact for the stop link. 409 when
 * opted out, 400 with no email; reviewSentAt is stamped only on success.
 * @param request - Incoming request.
 * @param params - Route params.
 * @param params.params - Destructured route params containing booking id.
 * @returns JSON with ok flag or error.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, reviewToken: true },
  });

  if (!booking) {
    return errorResponse("Booking not found.", 404);
  }
  if (!booking.email) {
    return errorResponse("Booking has no email to send a review request to.", 400);
  }

  const email = normaliseEmail(booking.email);
  const { contact } = await findOrCreateContactByEmail(email, { name: booking.name });

  const blockedBy = await reviewAskBlockedBy(contact.id);
  if (blockedBy) {
    return errorResponse(
      blockedBy === "review_opt_out"
        ? "They've asked not to get review requests."
        : "They've unsubscribed from your emails, so no review request was sent.",
      409,
    );
  }

  // The booking's own token keeps the review tied to the booking.
  const result = await sendReviewAsk({
    to: email,
    firstName: booking.name.split(" ")[0] ?? "",
    contactId: contact.id,
    reviewToken: booking.reviewToken,
  });
  if (result === "not_configured") {
    return errorResponse("Email isn't set up, so nothing was sent.", 503);
  }
  if (result === "failed") {
    return errorResponse("Failed to send review request.", 502);
  }

  await prisma.booking.update({
    where: { id },
    data: { reviewSentAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
