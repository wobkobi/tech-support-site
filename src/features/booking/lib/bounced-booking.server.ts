// src/features/booking/lib/bounced-booking.server.ts
// A hard-bounced confirmation email is the clearest sign of a fake booking; push the
// operator so the slot can be freed.

import { sendOwnerPush } from "@/features/notifications/lib/push";
import { formatDateTimeShort } from "@/shared/lib/date-format";
import { prisma } from "@/shared/lib/prisma";

/** How far back a booking counts as "just made"; a week covers Resend's retries. */
const RECENT_BOOKING_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pushes the operator about every live, recent booking under a hard-bounced address.
 * Never throws, so Resend doesn't retry the webhook and repeat the opt-out.
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
