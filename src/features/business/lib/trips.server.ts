// src/features/business/lib/trips.server.ts
// Prisma reads behind the trips page and API: an FY's trip log, and the "jobs without a
// trip" list. The eligibility and km rules live in trips.ts, where check-trips covers them.

import "server-only";

import { DAY_MS, type FinancialYear } from "@/features/business/lib/financial-year";
import {
  kmByAddressFrom,
  suggestTrips,
  toTripRow,
  type TripRow,
  type TripSuggestion,
} from "@/features/business/lib/trips";
import { prisma } from "@/shared/lib/prisma";

/** Fields a {@link TripRow} needs, shared by the page and every trips route. */
export const TRIP_SELECT = {
  id: true,
  date: true,
  km: true,
  purpose: true,
  bookingId: true,
  notes: true,
} as const;

/**
 * Trips in a ledger window, newest first, or every trip when the window is null. Trip
 * dates and FY bounds are both UTC midnight of an NZ day, so they compare directly.
 * @param window - FY bounds (start inclusive, end exclusive), or null for all trips.
 * @returns Serialisable trip rows.
 */
export async function loadTrips(window: { start: Date; end: Date } | null): Promise<TripRow[]> {
  const rows = await prisma.trip.findMany({
    where: window ? { date: { gte: window.start, lt: window.end } } : undefined,
    orderBy: [{ date: "desc" }, { id: "desc" }],
    select: TRIP_SELECT,
  });
  return rows.map(toTripRow);
}

/**
 * Completed (or past confirmed, or no-show) in-person jobs in the FY that have no trip
 * yet, each with a km prefill from the latest trip to the same address when one exists.
 * @param fy - The financial year (ledger-scale bounds).
 * @param now - Reference time for "has this confirmed job ended".
 * @returns Suggestions, newest first.
 */
export async function loadTripSuggestions(
  fy: Pick<FinancialYear, "start" | "end">,
  now: Date,
): Promise<TripSuggestion[]> {
  // Booking starts are real instants and the FY bounds are on the ledger scale, so pad
  // the query a day each side; suggestTrips places each job on its NZ day.
  const [bookings, linkedTrips] = await Promise.all([
    prisma.booking.findMany({
      where: {
        startAt: {
          gte: new Date(fy.start.getTime() - DAY_MS),
          lt: new Date(fy.end.getTime() + DAY_MS),
        },
        status: { in: ["completed", "confirmed", "cancelled"] },
      },
      select: {
        id: true,
        name: true,
        address: true,
        startAt: true,
        endAt: true,
        status: true,
        meetingType: true,
        noShow: true,
        calendarEventMissingAt: true,
        travelMinsAtBooking: true,
        travelMinsBackAtBooking: true,
      },
    }),
    prisma.trip.findMany({
      where: { bookingId: { not: null } },
      select: { bookingId: true, km: true, date: true },
    }),
  ]);

  // Every trip ever linked to a job counts, whatever FY the trip is dated in.
  const linkedIds = [...new Set(linkedTrips.flatMap((t) => (t.bookingId ? [t.bookingId] : [])))];
  const linkedBookings =
    linkedIds.length > 0
      ? await prisma.booking.findMany({
          where: { id: { in: linkedIds } },
          select: { id: true, address: true },
        })
      : [];

  const kmByAddress = kmByAddressFrom(
    linkedTrips.map((t) => ({ bookingId: t.bookingId, km: t.km, date: t.date.toISOString() })),
    new Map(linkedBookings.map((b) => [b.id, b.address])),
  );

  return suggestTrips(bookings, {
    linkedBookingIds: new Set(linkedIds),
    kmByAddress,
    startISO: fy.start.toISOString(),
    endISO: fy.end.toISOString(),
    now,
  });
}
