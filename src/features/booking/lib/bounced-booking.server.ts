// src/features/booking/lib/bounced-booking.server.ts
// A booking whose confirmation email hard-bounces was made with an address that
// doesn't exist, which is the clearest sign of a fake booking that got past the
// form's checks. The operator is pushed about it so the slot can be freed.

import { sendOwnerPush } from "@/features/notifications/lib/push";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";

/**
 * How far back a booking counts as "just made". Confirmations go out at booking
 * time, so a bounce is reported within minutes; a week leaves room for Resend
 * retrying a slow server before it gives up.
 */
const RECENT_BOOKING_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pushes the operator about every live, recently made booking under an address
 * that just hard-bounced. Never throws: a failure here must not make Resend
 * retry the webhook and repeat the opt-out.
 * @param emails - Lowercased bounced addresses from the webhook.
 * @param now - Current time, for the checks.
 * @returns Promise that resolves once every push has been attempted.
 */
export async function flagBouncedBookings(emails: string[], now = new Date()): Promise<void> {
  if (emails.length === 0) return;
  try {
    const bookings = await prisma.booking.findMany({
      where: {
        email: { in: emails },
        status: { in: ["held", "confirmed"] },
        createdAt: { gte: new Date(now.getTime() - RECENT_BOOKING_MS) },
      },
      select: { id: true, name: true, startAt: true },
    });
    await Promise.all(
      bookings.map((booking) =>
        sendOwnerPush({
          title: "Booking email bounced",
          body: `${booking.name} - ${formatDateTimeShort(booking.startAt)}. The email address doesn't exist, so this booking may be fake.`,
          url: `/admin/bookings/${booking.id}`,
          tag: `booking-bounce-${booking.id}`,
        }),
      ),
    );
  } catch (error) {
    console.error("[bounced-booking] Couldn't check bookings for a bounce:", error);
  }
}
