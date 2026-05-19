// src/app/api/cron/send-booking-reminders/route.ts
/**
 * @file route.ts
 * @description Cron that sends a 24h-out email reminder for confirmed bookings.
 *
 * Window: bookings starting in 3-25 hours from now, not previously emailed.
 * Idempotent via Booking.emailReminderSentAt. Designed to be called every
 * 15 minutes via cron-job.org so a booking enters the window on the next cron
 * run after the threshold.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { sendBookingReminderEmail } from "@/features/reviews/lib/email";
import { isCronAuthorized } from "@/shared/lib/auth";

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
    const in3h = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    // Bookings 3-25h out: the "24h before" window with 1h padding either side
    // so the cron's 15-min cadence always catches a booking entering it.
    const emailCandidates = await prisma.booking.findMany({
      where: {
        status: "confirmed",
        startAt: { gt: in3h, lte: in25h },
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
