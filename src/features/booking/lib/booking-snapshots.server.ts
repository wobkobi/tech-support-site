// src/features/booking/lib/booking-snapshots.server.ts
// What a new booking freezes when it's made: the drive there and back, the hourly and
// travel rates, and any public holiday, so a late cancel or the invoice bills the terms
// the customer booked under rather than today's.

import { lookupPublicHoliday } from "@/features/business/lib/pricing-policy.server";
import { lookupDriveRoundTrip } from "@/features/business/lib/travel-distance";
import { prisma } from "@/shared/lib/prisma";

/** The snapshot columns a new booking row stores. */
export interface BookingSnapshotColumns {
  travelMinsAtBooking: number | null;
  travelMinsBackAtBooking: number | null;
  baseRateAtBooking: number | null;
  travelRatePerHourAtBooking: number;
  publicHolidayName: string | null;
}

/**
 * Looks up every snapshot in parallel. Each lookup that fails is logged and saved as null,
 * as if there were nothing to snapshot, so a booking never fails over one.
 * @param params - Lookup inputs.
 * @param params.startAt - Booking start; the drive there is timed to arrive by it.
 * @param params.endAt - Booking end; the drive back leaves then.
 * @param params.address - Visit address, or null for a remote session (no drive).
 * @param params.travelRatePerHour - The live travel rate setting, frozen onto the row.
 * @param params.logTag - Route name for the warning logs.
 * @returns The columns to spread into `prisma.booking.create`.
 */
export async function lookupBookingSnapshots(params: {
  startAt: Date;
  endAt: Date;
  address: string | null;
  travelRatePerHour: number;
  logTag: string;
}): Promise<BookingSnapshotColumns> {
  const { startAt, endAt, address, logTag } = params;
  const [defaults, drive, holiday] = await Promise.all([
    prisma.rateConfig.findMany({ where: { isDefault: true } }).catch((err: unknown) => {
      console.warn(`[${logTag}] RateConfig snapshot fetch failed:`, err);
      return [];
    }),
    address
      ? lookupDriveRoundTrip(address, startAt, endAt).catch((err: unknown) => {
          console.warn(`[${logTag}] travel-time snapshot failed:`, err);
          return null;
        })
      : null,
    lookupPublicHoliday(startAt).catch((err: unknown) => {
      console.warn(`[${logTag}] public-holiday lookup failed:`, err);
      return null;
    }),
  ]);
  const legs = drive?.status === "ok" ? drive.data : null;
  return {
    travelMinsAtBooking: legs?.there.durationMins ?? null,
    travelMinsBackAtBooking: legs?.back.durationMins ?? null,
    baseRateAtBooking: defaults.find((r) => r.ratePerHour !== null)?.ratePerHour ?? null,
    travelRatePerHourAtBooking: params.travelRatePerHour,
    publicHolidayName: holiday?.name ?? null,
  };
}
