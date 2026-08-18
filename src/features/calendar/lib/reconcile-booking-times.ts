// src/features/calendar/lib/reconcile-booking-times.ts
/**
 * @description Pulls booking times back from Google Calendar.
 *
 * The operator corrects event times in Calendar - usually on a phone, after the
 * job - and the billing path already reads those live. The Booking row doesn't
 * follow, so reminder timing, review timing and the cancellation-fee windows go
 * on working off a stale start. This walks the bookings that own an event,
 * compares the row against the live event, and reports or applies the
 * difference. The calendar wins: it is where the correction was made.
 */

import { fetchBookingEvent } from "@/features/calendar/lib/google-calendar";
import { prisma } from "@/shared/lib/prisma";
import { Prisma } from "@prisma/client";

/** How many events to fetch at once - Google is fine with this, quota isn't. */
const FETCH_CONCURRENCY = 10;

/** Default lookback. Older bookings are history no reader still acts on. */
const DEFAULT_SINCE_DAYS = 60;

/** One booking whose row and calendar event disagree. */
export interface BookingTimeDrift {
  bookingId: string;
  /** Customer name, so a dry run reads without a second lookup. */
  name: string;
  /** What the Booking row currently says. */
  from: { startAt: Date; endAt: Date };
  /** What the calendar event says. */
  to: { startAt: Date; endAt: Date };
  /** Why the row was left alone, when it was. */
  skipped?: string;
}

/** Outcome of one reconcile pass. */
export interface ReconcileResult {
  /** Bookings that owned an event and were compared. */
  checked: number;
  /** Bookings whose event could not be read (deleted, all-day, API failure). */
  unreadable: number;
  /** Every disagreement found, applied or not. */
  drifted: BookingTimeDrift[];
}

/**
 * Compares booking rows against their live calendar events.
 * @param options - Pass options.
 * @param options.apply - Write the calendar's times back to the row. False only reports.
 * @param options.sinceDays - How far back to look, in days (defaults to 60).
 * @returns What was checked and what disagreed.
 */
export async function reconcileBookingTimes(options: {
  apply: boolean;
  sinceDays?: number;
}): Promise<ReconcileResult> {
  const since = new Date(Date.now() - (options.sinceDays ?? DEFAULT_SINCE_DAYS) * 86_400_000);

  // Cancelled bookings are excluded: their event is already deleted, so there
  // is nothing to compare against and nothing that still reads their times.
  const bookings = await prisma.booking.findMany({
    where: {
      calendarEventId: { not: null },
      status: { in: ["held", "confirmed", "completed"] },
      startAt: { gte: since },
    },
    select: {
      id: true,
      name: true,
      startAt: true,
      endAt: true,
      calendarEventId: true,
      activeSlotKey: true,
    },
    orderBy: { startAt: "asc" },
  });

  const result: ReconcileResult = { checked: 0, unreadable: 0, drifted: [] };

  for (let i = 0; i < bookings.length; i += FETCH_CONCURRENCY) {
    const batch = bookings.slice(i, i + FETCH_CONCURRENCY);
    const events = await Promise.all(
      // The non-null assertion is safe: the query filtered on it.
      batch.map((b) => fetchBookingEvent(b.calendarEventId!)),
    );

    for (const [index, booking] of batch.entries()) {
      const event = events[index];
      if (!event) {
        result.unreadable++;
        continue;
      }
      result.checked++;

      const startAt = new Date(event.start);
      const endAt = new Date(event.end);
      if (
        startAt.getTime() === booking.startAt.getTime() &&
        endAt.getTime() === booking.endAt.getTime()
      ) {
        continue;
      }

      const drift: BookingTimeDrift = {
        bookingId: booking.id,
        name: booking.name,
        from: { startAt: booking.startAt, endAt: booking.endAt },
        to: { startAt, endAt },
      };

      if (options.apply) {
        // Only a booking still holding its slot carries a live key; completed
        // rows keep `released:<id>` and must not reclaim one.
        const movesSlot = !booking.activeSlotKey?.startsWith("released:");
        try {
          await prisma.booking.update({
            where: { id: booking.id },
            data: {
              startAt,
              endAt,
              ...(movesSlot ? { activeSlotKey: startAt.toISOString() } : {}),
            },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            // Another live booking already holds that start. Leaving the row
            // stale is the lesser evil - the alternative is two bookings
            // claiming one slot - but it needs a human, so it's reported.
            drift.skipped = "another booking already starts at that time";
          } else {
            throw error;
          }
        }
      }

      result.drifted.push(drift);
    }
  }

  return result;
}
