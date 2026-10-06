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
 * Sends (or resends) the review ask for a booking. Lands a Contact for the booking's
 * email first, since the ask's stop link is signed per contact. Refuses with 409 when
 * the person has opted out of review asks or unsubscribed. Stamps reviewSentAt only
 * when the send succeeds; a booking with no email is rejected with 400.
 * Requires X-Admin-Secret header.
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

  // The booking's own token, so a review left through this link stays tied to the
  // booking. Only a real send stamps reviewSentAt, so a failure stays retryable.
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
