// src/app/api/booking/slots/route.ts
/**
 * @file route.ts
 * @description API route to get available booking slots.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  BOOKING_CONFIG,
  buildAvailableSlots,
  type ExistingBooking,
  type BookingSlot,
} from "@/lib/booking";
import { releaseExpiredHolds } from "@/lib/releaseExpiredHolds";

/**
 * Response containing available slots.
 */
interface AvailableSlotsResponse {
  /** List of available booking slots. */
  slots: BookingSlot[];
  /** The time zone used for slot labels. */
  timeZone: string;
}

/**
 * GET /api/booking/slots
 * Returns available booking slots.
 * @returns JSON response with available slots.
 */
export async function GET(): Promise<NextResponse<AvailableSlotsResponse>> {
  try {
    // Release expired holds first to free up slots
    await releaseExpiredHolds();

    const now = new Date();

    // Get existing bookings (both held and confirmed) for conflict detection
    const existingBookings = await prisma.booking.findMany({
      where: {
        status: { in: ["held", "confirmed"] },
        endUtc: { gte: now }, // Only future bookings matter
      },
      select: {
        id: true,
        startUtc: true,
        endUtc: true,
        bufferBeforeMin: true,
        bufferAfterMin: true,
      },
    });

    const existingForSlots: ExistingBooking[] = existingBookings.map((b) => ({
      id: b.id,
      startUtc: b.startUtc,
      endUtc: b.endUtc,
      bufferBeforeMin: b.bufferBeforeMin,
      bufferAfterMin: b.bufferAfterMin,
    }));

    const slots = buildAvailableSlots(existingForSlots, now, BOOKING_CONFIG);

    return NextResponse.json({
      slots,
      timeZone: BOOKING_CONFIG.timeZone,
    });
  } catch (error) {
    console.error("[booking/slots] Error:", error);
    return NextResponse.json({ slots: [], timeZone: BOOKING_CONFIG.timeZone }, { status: 500 });
  }
}
