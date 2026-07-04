// src/app/api/admin/bookings/[id]/resend-review/route.ts
/**
 * @description Admin API to manually (re)send a review request email for a booking.
 */

import { sendCustomerReviewRequest } from "@/features/reviews/lib/email";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/admin/bookings/[id]/resend-review
 * Sends (or resends) the review request email for a booking, bypassing the
 * reviewSentAt guard used by the cron. Stamps reviewSentAt only when the send
 * succeeds; a booking with no email is rejected with 400.
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

  // sendCustomerReviewRequest returns false on a Resend failure rather than
  // throwing; only stamp reviewSentAt when the send actually went out so a failed
  // send stays retryable.
  const sent = await sendCustomerReviewRequest(booking);
  if (!sent) {
    return errorResponse("Failed to send review request.", 502);
  }

  await prisma.booking.update({
    where: { id },
    data: { reviewSentAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
