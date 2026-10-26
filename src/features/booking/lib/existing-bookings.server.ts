// src/features/booking/lib/existing-bookings.server.ts
// Loads the bookings and calendar events that can block a slot; shared so no flow lets a
// double-booking through.

import type { ExistingBooking } from "@/features/booking/lib/booking";
import { CALENDAR_CACHE_STALE_MS } from "@/features/calendar/lib/calendar-cache";
import { fetchAllCalendarEventsStrict } from "@/features/calendar/lib/google-calendar";
import { prisma } from "@/shared/lib/prisma";

/**
 * Loads confirmed bookings that have not finished yet - the only ones that can conflict.
 * @param now - Cutoff instant; bookings ending before it are ignored.
 * @param options - Optional refinements.
 * @param options.excludeId - Booking to leave out, so a reschedule can reuse its own slot.
 * @returns Bookings in {@link ExistingBooking} shape.
 */
export async function loadBlockingBookings(
  now: Date,
  options: { excludeId?: string } = {},
): Promise<ExistingBooking[]> {
  return prisma.booking.findMany({
    where: {
      ...(options.excludeId ? { id: { not: options.excludeId } } : {}),
      status: "confirmed",
      endAt: { gte: now },
    },
    // Exactly the ExistingBooking fields.
    select: { id: true, startAt: true, endAt: true, bufferBeforeMin: true, bufferAfterMin: true },
  });
}

/**
 * Calendar events that can block a slot, for the submit-time check: live events from every
 * calendar plus the cached travel blocks the booking grid greys out. Throws when any calendar
 * failed to answer, since its events would read as free time.
 * @param now - Start of the window.
 * @param windowEnd - End of the window (bookingWindowEnd).
 * @param excludeEventId - A rescheduled booking's own event, so it can keep its time and travel.
 * @returns Events in the shape validateBookingRequest takes.
 */
export async function loadBlockingEvents(
  now: Date,
  windowEnd: Date,
  excludeEventId: string | null = null,
): Promise<Array<{ id: string; start: string; end: string }>> {
  const [live, travel] = await Promise.all([
    fetchAllCalendarEventsStrict(now, windowEnd),
    // Travel only lives in the cache; same freshness rule as the booking grid's read.
    prisma.calendarEventCache.findMany({
      where: {
        eventId: { startsWith: "travel-" },
        endAt: { gte: now },
        fetchedAt: { gt: new Date(now.getTime() - CALENDAR_CACHE_STALE_MS) },
      },
      select: { eventId: true, startAt: true, endAt: true },
    }),
  ]);

  const own = new Set(
    excludeEventId
      ? [excludeEventId, `travel-before:${excludeEventId}`, `travel-after:${excludeEventId}`]
      : [],
  );
  return [
    ...live.map((e) => ({ id: e.id, start: e.start, end: e.end })),
    ...travel.map((t) => ({
      id: t.eventId,
      start: t.startAt.toISOString(),
      end: t.endAt.toISOString(),
    })),
  ].filter((e) => !own.has(e.id));
}
