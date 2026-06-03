// src/app/api/cron/send-booking-reminders/route.ts
/**
 * @file route.ts
 * @description Cron that sends a 24h-out email reminder for confirmed bookings.
 *
 * Window: bookings starting in 13-25 hours from now, not previously emailed.
 * Idempotent via Booking.emailReminderSentAt. Called every 15 minutes via
 * cron-job.org. Lower bound = CANCELLATION.freeNoticeHours + 1 so reminders
 * always land while the customer can still cancel free - reading the $30
 * fee in a reminder would read as a bait-and-switch.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { sendBookingReminderEmail } from "@/features/reviews/lib/email";
import { isCronAuthorized } from "@/shared/lib/auth";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { getSettings } from "@/shared/lib/settings/get-settings";

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
    const { comms } = await getSettings();
    if (!comms.notifyReminder) {
      return NextResponse.json({ ok: true, skipped: "reminders disabled", emailsSent: 0 });
    }

    const now = new Date();
    const { CANCELLATION } = await getPolicy();
    // Send once the booking is inside the reminder lead window but still far
    // enough out that free cancellation is possible (lower bound).
    const lowerHours = CANCELLATION.freeNoticeHours + 1;
    const fromTime = new Date(now.getTime() + lowerHours * 60 * 60 * 1000);
    const upperTime = new Date(now.getTime() + comms.reminderLeadHours * 60 * 60 * 1000);

    const emailCandidates = await prisma.booking.findMany({
      where: {
        status: "confirmed",
        startAt: { gt: fromTime, lte: upperTime },
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
        promoTitleAtBooking: true,
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
          promoTitleAtBooking: b.promoTitleAtBooking,
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
