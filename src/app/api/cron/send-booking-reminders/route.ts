// src/app/api/cron/send-booking-reminders/route.ts
/**
 * @file route.ts
 * @description Cron that sends appointment reminders.
 *
 * Two non-overlapping windows so the customer never gets both reminders in
 * quick succession:
 *
 * - **Email reminder**: confirmed bookings starting in 3-25 hours from now,
 *   not previously emailed. Idempotent via Booking.emailReminderSentAt.
 * - **SMS reminder**: confirmed bookings starting in 0-4 hours from now,
 *   not previously SMSed, with a phone number on file. Idempotent via
 *   Booking.smsReminderSentAt.
 *
 * Designed to be called every 15 minutes via cron-job.org so a booking enters
 * each window on the next cron run after the threshold.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { sendBookingReminderEmail } from "@/features/reviews/lib/email";
// SMS reminders are currently disabled (ClickSend trial limits + cost review).
// Re-enable: uncomment the import, the smsCandidates query, the SMS loop, and
// the BookingForm opt-in checkbox.
// import { sendBookingReminderSms } from "@/features/booking/lib/sms";
import { isCronAuthorized } from "@/shared/lib/auth";
// import { isValidPhone } from "@/shared/lib/normalize-phone";

/**
 * GET /api/cron/send-booking-reminders
 * @param request - Incoming cron request.
 * @returns JSON `{ ok, emailsSent, smsSent, failed, errors }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const in3h = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    // const in4h = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    // Email reminders: bookings 3-25h out (the "24h before" window, with
    // 1h padding either side so the cron's 15-min cadence always catches it).
    // The 3h floor leaves room for the SMS window to fire alone for sooner
    // appointments without the email also firing on the same cron run.
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

    // SMS reminders disabled - see note at top of file.
    // const smsCandidates = await prisma.booking.findMany({
    //   where: {
    //     status: "confirmed",
    //     startAt: { gt: now, lte: in4h },
    //     phone: { not: null },
    //     smsOptIn: true,
    //     OR: [{ smsReminderSentAt: null }, { smsReminderSentAt: { isSet: false } }],
    //   },
    //   select: { id: true, name: true, phone: true, startAt: true },
    // });

    console.log(
      `[cron/send-booking-reminders] found ${emailCandidates.length} email candidate(s) (SMS disabled)`,
    );

    const results = { emailsSent: 0, smsSent: 0, failed: 0, errors: [] as string[] };

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

    // SMS send loop disabled - see note at top of file.
    // for (const b of smsCandidates) {
    //   if (!b.phone) continue;
    //   if (!isValidPhone(b.phone)) {
    //     console.warn(
    //       `[cron/send-booking-reminders] booking ${b.id} has invalid phone ${b.phone}; skipping`,
    //     );
    //     results.failed++;
    //     results.errors.push(`sms ${b.id}: invalid phone`);
    //     continue;
    //   }
    //   try {
    //     const ok = await sendBookingReminderSms({
    //       name: b.name,
    //       phone: b.phone,
    //       startAt: b.startAt,
    //     });
    //     if (ok) {
    //       await prisma.booking.update({
    //         where: { id: b.id },
    //         data: { smsReminderSentAt: now },
    //       });
    //       results.smsSent++;
    //     } else {
    //       results.failed++;
    //     }
    //   } catch (error) {
    //     results.failed++;
    //     results.errors.push(`sms ${b.id}: ${error}`);
    //     console.error(`[cron/send-booking-reminders] SMS for ${b.id} failed:`, error);
    //   }
    // }

    console.log(
      `[cron/send-booking-reminders] done: emails=${results.emailsSent} sms=${results.smsSent} failed=${results.failed}`,
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
