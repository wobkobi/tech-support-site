// src/app/api/cron/send-booking-reminders/route.ts
/**
 * @file route.ts
 * @description Cron that sends a 24h-out email reminder for confirmed bookings.
 *
 * Window: bookings starting in 13-25 hours from now, not previously emailed.
 * Idempotent via Booking.emailReminderSentAt. Designed to be called every
 * 15 minutes via cron-job.org so a booking enters the window on the next cron
 * run after the threshold.
 *
 * Lower bound is CANCELLATION.freeNoticeHours + 1 (12 + 1 = 13) so the
 * reminder always lands while the customer can still cancel free. Otherwise
 * a reminder firing at 3h-out would be the first thing the customer sees
 * about the $30 callout fee that's about to apply if they want to cancel,
 * which reads as a bait-and-switch.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { sendBookingReminderEmail } from "@/features/reviews/lib/email";
import { isCronAuthorized } from "@/shared/lib/auth";
import { CANCELLATION } from "@/features/business/lib/pricing-policy";

/**
 * GET /api/cron/send-booking-reminders
 * @param request - Incoming cron request.
 * @returns JSON `{ ok, emailsSent, failed, errors }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    // Lower bound = CANCELLATION.freeNoticeHours + 1 so the reminder always
    // lands while the customer can still cancel free. Anything below that
    // would deliver a "you can no longer cancel without a fee" message as
    // the first the customer hears of it.
    const lowerHours = CANCELLATION.freeNoticeHours + 1;
    const fromTime = new Date(now.getTime() + lowerHours * 60 * 60 * 1000);
    const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    // Bookings in the (freeNoticeHours + 1, 25h] window: the "24h before"
    // reminder with padding above so the cron's 15-min cadence always
    // catches a booking entering it.
    const emailCandidates = await prisma.booking.findMany({
      where: {
        status: "confirmed",
        startAt: { gt: fromTime, lte: in25h },
        OR: [{ emailReminderSentAt: null }, { emailReminderSentAt: { isSet: false } }],
      },
      select: {
        id: true,
        name: true,
        email: true,
        notes: true,
        startAt: true,
        endAt: true,
        cancelToken: true,
      },
    });

    console.log(`[cron/send-booking-reminders] found ${emailCandidates.length} email candidate(s)`);

    const results = { emailsSent: 0, failed: 0, errors: [] as string[] };

    for (const b of emailCandidates) {
      try {
        const ok = await sendBookingReminderEmail({
          id: b.id,
          name: b.name,
          email: b.email,
          notes: b.notes ?? "",
          startAt: b.startAt,
          endAt: b.endAt,
          cancelToken: b.cancelToken,
        });
        // Only stamp sent-at after Resend accepts the send. Stamping before
        // would silently drop the reminder forever on a transient hiccup,
        // since the next cron run would skip a non-null timestamp. A duplicate
        // send (if the cron times out between the send and the update) is
        // recoverable; a missed appointment reminder isn't.
        if (ok) {
          await prisma.booking.update({
            where: { id: b.id },
            data: { emailReminderSentAt: now },
          });
          results.emailsSent++;
        } else {
          results.failed++;
        }
      } catch (error) {
        results.failed++;
        results.errors.push(`email ${b.id}: ${error}`);
        console.error(`[cron/send-booking-reminders] email for ${b.id} failed:`, error);
      }
    }

    console.log(
      `[cron/send-booking-reminders] done: emails=${results.emailsSent} failed=${results.failed}`,
    );
    return NextResponse.json({ ok: true, ...results });
  } catch (error) {
    console.error("[cron/send-booking-reminders] error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to send booking reminders" },
      { status: 500 },
    );
  }
}
