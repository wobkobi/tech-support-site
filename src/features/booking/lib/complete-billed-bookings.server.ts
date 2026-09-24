// Marks the bookings behind a freshly billed invoice as completed. Raising an invoice for a
// booked timeslot is the operator saying the job happened, so the booking shouldn't sit
// on "confirmed" waiting for a separate Complete click.

import { SCHEDULE_CALENDAR_TAG } from "@/features/calendar/lib/google-calendar";
import { prisma } from "@/shared/lib/prisma";
import { revalidateTag } from "next/cache";

/** What an invoice carries that ties it back to booked timeslots. */
export interface BilledBookingRefs {
  bookingId?: string | null;
  calendarEventId?: string | null;
  calendarEventIds?: string[];
}

/**
 * Completes every confirmed, already-started booking the invoice bills. A merged job can
 * span several bookings but the invoice holds one bookingId, so the rest are found by
 * their calendar event ids. Held, cancelled and future bookings are left alone: a hold
 * is not a job, and releasing a future slot would let someone else book over it.
 *
 * No review email goes out here, unlike the booking page's Complete action - the invoice
 * email carries its own review link, and the review cron still covers the booking.
 * Never throws; a failure is logged and the invoice stands.
 * @param refs - Booking id and calendar event ids from the invoice.
 * @param logTag - Log prefix of the calling route.
 * @returns How many bookings were marked completed.
 */
export async function completeBilledBookings(
  refs: BilledBookingRefs,
  logTag: string,
): Promise<number> {
  const eventIds = [
    ...new Set([refs.calendarEventId, ...(refs.calendarEventIds ?? [])].filter(Boolean)),
  ] as string[];
  const or = [
    ...(refs.bookingId ? [{ id: refs.bookingId }] : []),
    ...(eventIds.length > 0 ? [{ calendarEventId: { in: eventIds } }] : []),
  ];
  if (or.length === 0) return 0;

  try {
    const bookings = await prisma.booking.findMany({
      where: { OR: or, status: "confirmed", startAt: { lte: new Date() } },
      select: { id: true },
    });
    // One update per row: the released slot key embeds the row's own id.
    for (const { id } of bookings) {
      await prisma.booking.update({
        where: { id },
        data: { status: "completed", activeSlotKey: `released:${id}` },
      });
    }
    if (bookings.length > 0) revalidateTag(SCHEDULE_CALENDAR_TAG, {});
    return bookings.length;
  } catch (err) {
    console.error(`${logTag} Couldn't mark billed bookings completed:`, err);
    return 0;
  }
}
