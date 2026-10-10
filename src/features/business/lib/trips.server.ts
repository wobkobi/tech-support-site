// src/features/business/lib/trips.server.ts
// Server side of the trips log: an FY's trip log, the "jobs without a trip" list, the
// Google round-trip km lookup, and the trip an invoice save logs for its job. The
// eligibility and km rules live in trips.ts, where check-trips covers them.

import "server-only";

import { DAY_MS, type FinancialYear } from "@/features/business/lib/financial-year";
import { lookupDriveRoundTrip } from "@/features/business/lib/travel-distance";
import {
  kmByAddressFrom,
  MAX_PURPOSE_LEN,
  MAX_TRIP_KM,
  suggestTrips,
  toTripRow,
  type AutoTripResult,
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

/** Outcome of {@link driveRoundTripKm}: the km, or why Google gave none. */
export type RoundTripKmResult =
  { status: "ok"; km: number } | { status: "no_match" | "misconfig" | "error" };

/**
 * Round-trip driving km from the base address (there plus back, one decimal). Both legs
 * are quoted leaving now: the distance is what's wanted, and Google refuses past
 * departure times. Costs two Distance Matrix elements per call.
 * @param address - Destination address.
 * @returns The km, or `no_match` when Google finds no route (or one longer than a trip
 *   may log), `misconfig` when the base address or Maps key is missing, `error` upstream.
 */
export async function driveRoundTripKm(address: string): Promise<RoundTripKmResult> {
  const result = await lookupDriveRoundTrip(address);
  if (result.status !== "ok") return result;
  const { there, back } = result.data;
  const km = Math.round((there.distanceKm + back.distanceKm) * 10) / 10;
  return km > 0 && km <= MAX_TRIP_KM ? { status: "ok", km } : { status: "no_match" };
}

/**
 * Logs the trip for a job an invoice just billed that you drove to, at Google's round-trip km.
 * One trip per job: a trip already linked to the booking or to any of the billed events
 * counts, so re-billing a job (a voided invoice re-issued) never logs a second. Never
 * throws; the invoice is already saved, so a failure only comes back as a status.
 * @param job - The billed job.
 * @param job.bookingId - Booking the invoice billed, if any.
 * @param job.calendarEventIds - Calendar events the invoice billed, earliest first.
 * @param job.address - Job address to drive to.
 * @param job.date - Ledger date of the job (UTC midnight of the NZ day).
 * @param job.clientName - Client, for the trip's purpose.
 * @param job.invoiceNumber - Invoice number, noted on the trip.
 * @returns What happened, for the calculator's toast.
 */
export async function autoLogJobTrip(job: {
  bookingId: string | null;
  calendarEventIds: readonly string[];
  address: string;
  date: Date;
  clientName: string;
  invoiceNumber: string;
}): Promise<AutoTripResult> {
  const links = [
    ...(job.bookingId ? [{ bookingId: job.bookingId }] : []),
    ...(job.calendarEventIds.length > 0
      ? [{ calendarEventId: { in: [...job.calendarEventIds] } }]
      : []),
  ];
  // Without a booking or event there is nothing to stop a second save logging it twice.
  if (links.length === 0) return { status: "failed" };
  try {
    const existing = await prisma.trip.findFirst({ where: { OR: links }, select: { id: true } });
    if (existing) return { status: "exists" };

    const lookup = await driveRoundTripKm(job.address);
    if (lookup.status === "no_match") return { status: "no_route" };
    if (lookup.status !== "ok") {
      console.error(`[auto-trip] Google km lookup failed (${lookup.status})`);
      return { status: "failed" };
    }

    await prisma.trip.create({
      data: {
        date: job.date,
        km: lookup.km,
        purpose: `Job: ${job.clientName}`.slice(0, MAX_PURPOSE_LEN),
        notes: `Logged from invoice ${job.invoiceNumber}.`,
        bookingId: job.bookingId,
        calendarEventId: job.calendarEventIds[0] ?? null,
      },
    });
    return { status: "logged", km: lookup.km };
  } catch (err) {
    console.error("[auto-trip] Could not log the job's trip:", err);
    return { status: "failed" };
  }
}
