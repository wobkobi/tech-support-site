// src/app/api/cron/send-booking-reminders/route.ts
// Cron (every 30 min, must not be slowed) sending a 24h-out reminder for confirmed
// bookings, idempotent via emailReminderSentAt. The lower bound (freeNoticeHours + 1)
// keeps reminders inside free cancellation. The window can be just 1 hour wide and a
// stepped-over booking is never revisited.

import {
  CALENDAR_EVENT_PRESENT_FILTER,
  combineUnitAndAddress,
} from "@/features/booking/lib/booking";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { sendBookingReminderEmail } from "@/features/reviews/lib/email-booking";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/send-booking-reminders
 * @param request - Incoming cron request.
 * @returns JSON `{ ok, emailsSent, failed, errors }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const { comms } = await getSettings();
    if (!comms.notifyReminder) {
      return NextResponse.json({ ok: true, skipped: "reminders disabled", emailsSent: 0 });
    }

    const now = new Date();
    const { CANCELLATION } = await getPolicy();
    // Lower bound keeps the booking far enough out for free cancellation.
    const lowerHours = CANCELLATION.freeNoticeHours + 1;
    const fromTime = new Date(now.getTime() + lowerHours * 60 * 60 * 1000);
    const upperTime = new Date(now.getTime() + comms.reminderLeadHours * 60 * 60 * 1000);

    const emailCandidates = await prisma.booking.findMany({
      where: {
        status: "confirmed",
        startAt: { gt: fromTime, lte: upperTime },
        // Under AND: a second top-level OR would overwrite the first.
        AND: [
          { OR: [{ emailReminderSentAt: null }, { emailReminderSentAt: { isSet: false } }] },
          CALENDAR_EVENT_PRESENT_FILTER,
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        notes: true,
        accessNotes: true,
        startAt: true,
        endAt: true,
        cancelToken: true,
        promoTitleAtBooking: true,
        address: true,
        unit: true,
        meetingType: true,
        rescheduleCount: true,
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
          accessNotes: b.accessNotes,
          startAt: b.startAt,
          endAt: b.endAt,
          cancelToken: b.cancelToken,
          promoTitleAtBooking: b.promoTitleAtBooking,
          address: combineUnitAndAddress(b.unit ?? "", b.address ?? ""),
          meetingType: b.meetingType,
          rescheduleCount: b.rescheduleCount,
        });
        // Stamp only after Resend accepts: a duplicate is recoverable, a missed reminder isn't.
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
        results.errors.push(`email ${b.id}: ${String(error)}`);
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
