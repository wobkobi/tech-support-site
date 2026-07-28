// src/features/booking/lib/existing-bookings.server.ts
/**
 * @description Loads the bookings that can block a slot, in the shape the slot
 * engine expects. The public booking flow, the edit flow and the edit page all
 * need the same query, and a select that drifts here would silently let a
 * double-booking through.
 */

import type { ExistingBooking } from "@/features/booking/lib/booking";
import { prisma } from "@/shared/lib/prisma";

/**
 * Loads held and confirmed bookings that have not finished yet.
 *
 * Only these can conflict: cancelled and completed bookings free their slot,
 * and anything already ended cannot overlap a future one.
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
      status: { in: ["held", "confirmed"] },
      endAt: { gte: now },
    },
    // Selects exactly the ExistingBooking fields, so the result needs no
    // re-projection at the call sites.
    select: { id: true, startAt: true, endAt: true, bufferBeforeMin: true, bufferAfterMin: true },
  });
}
