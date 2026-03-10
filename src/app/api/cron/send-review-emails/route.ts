// src/app/api/cron/send-review-emails/route.ts
/**
 * @file route.ts
 * @description Cron job that sends review request emails 30 minutes after appointments.
 * Called externally via cron-job.org every 15 minutes.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { sendCustomerReviewRequest } from "@/features/reviews/lib/email";
import { isCronAuthorized } from "@/shared/lib/auth";

/**
 * GET /api/cron/send-review-emails
 * Finds completed appointments from 30 minutes ago and sends review requests.
 * Designed to be called every 15 minutes via cron-job.org.
 * @param request - The incoming cron request
 * @returns JSON response with results
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

    // Find bookings that:
    // 1. Ended at least 30 minutes ago (appointment is definitely over)
    // 2. Are confirmed
    // 3. Haven't had review email sent yet
    // reviewSentAt prevents duplicates across runs
    const bookingsToEmail = await prisma.booking.findMany({
      where: {
        endUtc: {
          lte: thirtyMinutesAgo,
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

    // Deduplicate by email: skip bookings whose email already received a review request
    // (either from another booking or a manual ReviewRequest record)
    const alreadyEmailedBookings = await prisma.booking.findMany({
      where: { reviewSentAt: { not: null } },
      select: { email: true },
    });
    const alreadyEmailedRequests = await prisma.reviewRequest.findMany({
      where: { email: { not: null } },
      select: { email: true },
    });
    const reviewedEmails = new Set([
      ...alreadyEmailedBookings.map((b) => b.email.toLowerCase()),
      ...alreadyEmailedRequests.map((r) => r.email!.toLowerCase()),
    ]);

    // Within-batch dedup: only send once per email if multiple bookings for same person
    const seenInBatch = new Set<string>();
    const toSend: typeof bookingsToEmail = [];
    const toSuppress: typeof bookingsToEmail = [];
    for (const b of bookingsToEmail) {
      const key = b.email.toLowerCase();
      if (reviewedEmails.has(key) || seenInBatch.has(key)) {
        toSuppress.push(b);
      } else {
        seenInBatch.add(key);
        toSend.push(b);
      }
    }

    // Mark suppressed bookings as sent so they don't reappear in future cron runs
    if (toSuppress.length > 0) {
      await prisma.booking.updateMany({
        where: { id: { in: toSuppress.map((b) => b.id) } },
        data: { reviewSentAt: now },
      });
    }

    const results = {
      found: bookingsToEmail.length,
      suppressed: toSuppress.length,
      sent: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const booking of toSend) {
      try {
        // Mark as sent FIRST to prevent duplicate emails if send fails after DB update
        // Trade-off: if send fails, we've marked it (won't retry), but this prevents spam
        await prisma.booking.update({
          where: { id: booking.id },
          data: {
            reviewSentAt: now,
          },
        });

        // Send email SECOND (best-effort delivery; failures are logged)
        await sendCustomerReviewRequest(booking);

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
