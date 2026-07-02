// src/app/api/cron/send-review-emails/route.ts
/**
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

    // Deduplicate by email: skip bookings whose email already received a review request
    // (either from another booking or a manual Contact send via admin).
    // Only query emails that are actually in this batch to avoid full-table scans.
    // Soft-deleted contacts don't count as "already emailed".
    const batchEmails = bookingsToEmail.map((b) => b.email);
    const [alreadyEmailedBookings, alreadyEmailedContacts] = await Promise.all([
      batchEmails.length > 0
        ? prisma.booking.findMany({
            where: { reviewSentAt: { not: null }, email: { in: batchEmails } },
            select: { email: true },
          })
        : Promise.resolve([] as { email: string }[]),
      batchEmails.length > 0
        ? prisma.contact.findMany({
            where: {
              reviewLinkSentAt: { not: null },
              deletedAt: null,
              OR: [{ email: { in: batchEmails } }, { altEmails: { hasSome: batchEmails } }],
            },
            select: { email: true, altEmails: true },
          })
        : Promise.resolve([] as { email: string | null; altEmails: string[] }[]),
    ]);
    // A contact who was sent a link suppresses any batch booking under its
    // primary OR alt emails, so a two-email person isn't asked twice.
    const batchEmailSet = new Set(batchEmails.map((e) => e.toLowerCase()));
    const reviewedEmails = new Set([
      ...alreadyEmailedBookings.map((b) => b.email.toLowerCase()),
      ...alreadyEmailedContacts.flatMap((c) =>
        [c.email, ...c.altEmails]
          .filter((e): e is string => !!e)
          .map((e) => e.toLowerCase())
          .filter((e) => batchEmailSet.has(e)),
      ),
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
        // Mark as sent FIRST so a crash between the write and the send can never
        // double-email. If the send itself reports failure we stamp
        // reviewSendFailedAt so the retry pass below gives it exactly one more go.
        await prisma.booking.update({
          where: { id: booking.id },
          data: { reviewSentAt: now },
        });

        const ok = await sendCustomerReviewRequest(booking);
        if (ok) {
          results.sent++;
        } else {
          await prisma.booking.update({
            where: { id: booking.id },
            data: { reviewSendFailedAt: now },
          });
          results.failed++;
          results.errors.push(`Booking ${booking.id}: send failed (will retry once)`);
        }
      } catch (error) {
        console.error(`[review-email] Failed for booking ${booking.id}:`, error);
        results.failed++;
        results.errors.push(`Booking ${booking.id}: ${error}`);
      }
    }

    // Retry pass: bookings whose previous send reported failure get one more
    // attempt. The flag is cleared either way (cap of one retry) so a persistent
    // failure gives up rather than emailing forever.
    const failedBookings = await prisma.booking.findMany({
      where: { reviewSendFailedAt: { not: null } },
      select: { id: true, name: true, email: true, reviewToken: true },
    });
    let retried = 0;
    for (const booking of failedBookings) {
      const ok = await sendCustomerReviewRequest(booking);
      await prisma.booking.update({
        where: { id: booking.id },
        data: { reviewSendFailedAt: null },
      });
      if (ok) {
        retried++;
        results.sent++;
      } else {
        console.warn(`[review-email] Giving up on booking ${booking.id} after one retry.`);
      }
    }

    console.log(
      `[cron/send-review-emails] done: sent=${results.sent} suppressed=${results.suppressed} failed=${results.failed} retried=${retried}`,
    );

    return NextResponse.json({
      ok: true,
      ...results,
      retried,
    });
  } catch (error) {
    console.error("[review-email] Cron error:", error);
    return errorResponse("Failed to send review emails", 500);
  }
}
