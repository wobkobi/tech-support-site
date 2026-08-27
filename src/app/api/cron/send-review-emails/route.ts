// src/app/api/cron/send-review-emails/route.ts
/**
 * @description Cron job that sends review request emails once a booking has been
 * finished for the configured delay. Called externally via cron-job.org hourly.
 * The query is unbounded catch-up work ("ended long enough ago and not yet
 * emailed"), so the cadence only shifts when a mail goes out, never whether it
 * does - safe to slow further if function CPU ever needs trimming again.
 */

import { CALENDAR_EVENT_PRESENT_FILTER } from "@/features/booking/lib/booking";
import { sendCustomerReviewRequest } from "@/features/reviews/lib/email";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/cron/send-review-emails
 * Finds completed appointments past the configured delay and sends review requests.
 * Designed to be called hourly via cron-job.org.
 * @param request - The incoming cron request
 * @returns JSON response with results
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
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

    // Bookings whose calendar event was deleted are excluded: the job was called off in
    // Calendar and nobody cancelled the row, so asking how it went would be asking about
    // a visit that never happened.
    //
    // Mongo gotcha: `reviewSentAt: null` matches explicit nulls only and skips docs
    // written before the field existed; `isSet: false` alone skips the opposite case.
    // Both arms are needed, and both ORs sit under AND since a second top-level one wins.
    const bookingsToEmail = await prisma.booking.findMany({
      where: {
        endAt: {
          lte: delayAgo,
        },
        status: { in: ["confirmed", "completed"] },
        AND: [
          { OR: [{ reviewSentAt: null }, { reviewSentAt: { isSet: false } }] },
          CALENDAR_EVENT_PRESENT_FILTER,
        ],
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

    // Deduplicate by email: skip bookings whose address already got a request, from
    // another booking or a manual admin send. Only emails in this batch are queried, to
    // avoid a full-table scan, and soft-deleted contacts don't count as already emailed.
    const batchEmails = bookingsToEmail.map((b) => b.email);
    const [alreadyEmailedBookings, alreadyEmailedContacts, alreadyLinkedInvoices] =
      await Promise.all([
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
        // An invoice that already carried a review link suppresses the cron for
        // that customer, mirroring the three-source check in getInvoiceReviewEligibility
        // so an invoice-then-cron order can't double-ask.
        batchEmails.length > 0
          ? prisma.invoice.findMany({
              where: { reviewLinkSentAt: { not: null }, clientEmail: { in: batchEmails } },
              select: { clientEmail: true },
            })
          : Promise.resolve([] as { clientEmail: string | null }[]),
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
      ...alreadyLinkedInvoices
        .map((i) => i.clientEmail?.toLowerCase())
        .filter((e): e is string => !!e),
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
        // Same failure marker the `ok === false` branch uses: reviewSentAt is already
        // claimed above, so without it the booking falls out of both the main query and
        // the retry pass. sendCustomerReviewRequest only wraps its Resend call.
        try {
          await prisma.booking.update({
            where: { id: booking.id },
            data: { reviewSendFailedAt: now },
          });
        } catch (stampError) {
          console.error(`[review-email] Could not flag ${booking.id} for retry:`, stampError);
        }
        results.failed++;
        results.errors.push(`Booking ${booking.id}: ${String(error)}`);
      }
    }

    // Retry pass: bookings whose previous send reported failure get one more
    // attempt. The flag is cleared either way (cap of one retry) so a persistent
    // failure gives up rather than emailing forever.
    const failedBookings = await prisma.booking.findMany({
      // Same calendar guard as the main query: a booking flagged between the
      // failed send and this pass must not be retried into a job that's off.
      where: { reviewSendFailedAt: { not: null }, ...CALENDAR_EVENT_PRESENT_FILTER },
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
