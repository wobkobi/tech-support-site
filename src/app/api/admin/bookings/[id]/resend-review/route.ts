// src/app/api/admin/bookings/[id]/resend-review/route.ts
/**
 * @file route.ts
 * @description Admin API to manually (re)send a review request email for a booking.
 */

import { sendCustomerReviewRequest } from "@/features/reviews/lib/email";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/admin/bookings/[id]/resend-review
 * Sends (or resends) the review request email for a booking, bypassing the
 * reviewSentAt guard used by the cron. Updates reviewSentAt after the call.
 * Requires X-Admin-Secret header. sendCustomerReviewRequest never throws,
 * so reviewSentAt is always updated regardless of Resend delivery status.
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, reviewToken: true },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  }

  await sendCustomerReviewRequest(booking);

  await prisma.booking.update({
    where: { id },
    data: { reviewSentAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
