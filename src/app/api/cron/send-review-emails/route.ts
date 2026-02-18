// src/app/api/cron/send-review-emails/route.ts
/**
 * @file route.ts
 * @description Cron job that sends review request emails 1 hour after appointments.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendCustomerReviewRequest } from "@/lib/email";

/**
 * Verify the request is from Vercel Cron or has the correct secret.
 * @param request - The incoming request to verify.
 * @returns True if authorized, false otherwise.
 */
function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return request.headers.has("x-vercel-cron");
  }

  return request.headers.has("x-vercel-cron") || authHeader === `Bearer ${cronSecret}`;
}


/**
 * GET /api/cron/send-review-emails
 * Finds completed appointments from 1 hour ago and sends review requests
 * @param request - The incoming cron request
 * @returns JSON response with results
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Find bookings that:
    // 1. Ended at least 1 hour ago (appointment is definitely over)
    // 2. Are confirmed
    // 3. Haven't had review email sent yet
    // reviewSentAt prevents duplicates across daily runs
    const bookingsToEmail = await prisma.booking.findMany({
      where: {
        endUtc: {
          lte: oneHourAgo,
        },
        status: "confirmed",
        reviewSentAt: null, // Haven't sent review email yet
      },
      select: {
        id: true,
        name: true,
        email: true,
        reviewToken: true,
      },
    });

    const results = {
      found: bookingsToEmail.length,
      sent: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const booking of bookingsToEmail) {
      try {
        await sendCustomerReviewRequest(booking);

        // Mark as sent
        await prisma.booking.update({
          where: { id: booking.id },
          data: {
            reviewSentAt: now,
          },
        });

        results.sent++;
      } catch (error) {
        console.error(`[review-email] Failed for booking ${booking.id}:`, error);
        results.failed++;
        results.errors.push(`Booking ${booking.id}: ${error}`);
      }
    }

    return NextResponse.json({
      ok: true,
      ...results,
    });
  } catch (error) {
    console.error("[review-email] Cron error:", error);
    return NextResponse.json({ ok: false, error: "Failed to send review emails" }, { status: 500 });
  }
}
