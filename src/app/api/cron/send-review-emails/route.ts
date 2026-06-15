// src/app/api/cron/send-review-emails/route.ts
/**
 * @file route.ts
 * @description Cron job that sends review request emails 30 minutes after appointments.
 * Called externally via cron-job.org every 15 minutes.
 */

import { sendCustomerReviewRequest } from "@/features/reviews/lib/email";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorized } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/cron/send-review-emails
 * Finds completed appointments from 30 minutes ago and sends review requests.
 * Designed to be called every 15 minutes via cron-job.org.
 * @param request - The incoming cron request
 * @returns JSON response with results
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    // Load settings and compute the cutoff
    const { comms } = await getSettings();
    if (!comms.notifyReviewRequest) {
      return NextResponse.json({ ok: true, skipped: "review requests disabled", sent: 0 });
    }

    const now = new Date();
    const delayAgo = new Date(now.getTime() - comms.reviewEmailDelayMins * 60 * 1000);

    // Find confirmed/completed bookings that ended at least the configured
    // delay ago and have not had a review email yet.
    //
    // MongoDB gotcha: documents written before reviewSentAt existed in the
    // schema have no `reviewSentAt` field at all (not even null). Prisma's
    // `reviewSentAt: null` filter only matches explicit nulls and skips
    // those documents. Using `isSet: false` on its own would skip the
    // opposite case (field present and null). The OR covers both.
    const bookingsToEmail = await prisma.booking.findMany({
      where: {
        endAt: {
          lte: delayAgo,
        },
        status: { in: ["confirmed", "completed"] },
        OR: [{ reviewSentAt: null }, { reviewSentAt: { isSet: false } }],
      },
      select: {
        id: true,
        name: true,
        email: true,
        reviewToken: true,
      },
    });

    console.log(
      `[cron/send-review-emails] found ${bookingsToEmail.length} candidate booking(s)`,
      bookingsToEmail.map((b) => ({ id: b.id, email: b.email })),
    );

    if (bookingsToEmail.length === 0) {
      return NextResponse.json({
        ok: true,
        found: 0,
        suppressed: 0,
        sent: 0,
        failed: 0,
        errors: [],
      });
    }

    // Deduplicate by email: skip bookings whose email already received a review request
    // (either from another booking or a manual Contact send via admin).
    // Only query emails that are actually in this batch to avoid full-table scans.
    const batchEmails = bookingsToEmail.map((b) => b.email);
    const [alreadyEmailedBookings, alreadyEmailedContacts] = await Promise.all([
      prisma.booking.findMany({
        where: { reviewSentAt: { not: null }, email: { in: batchEmails } },
        select: { email: true },
      }),
      prisma.contact.findMany({
        where: { reviewLinkSentAt: { not: null }, email: { in: batchEmails } },
        select: { email: true },
      }),
    ]);
    const reviewedEmails = new Set([
      ...alreadyEmailedBookings.map((b) => b.email.toLowerCase()),
      ...alreadyEmailedContacts.map((c) => c.email!.toLowerCase()),
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
        // Mark as sent FIRST to prevent duplicate emails if send fails after DB update.
        // Trade-off: a failed send stays marked (no retry), but this prevents spam.
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

    console.log(
      `[cron/send-review-emails] done: sent=${results.sent} suppressed=${results.suppressed} failed=${results.failed}`,
    );

    return NextResponse.json({
      ok: true,
      ...results,
    });
  } catch (error) {
    console.error("[review-email] Cron error:", error);
    return errorResponse("Failed to send review emails", 500);
  }
}
