// src/features/booking/lib/existing-bookings.server.ts
// Loads the bookings that can block a slot; one shared query so no flow lets a
// double-booking through.

import type { ExistingBooking } from "@/features/booking/lib/booking";
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
