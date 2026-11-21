// src/app/api/booking/travel-slots/route.ts
// Public drive check for the booking grid: once the customer's address is known, the starts the
// drive from the previous job (or, today, from where your phone is) or on to the next one rules
// out. Only the blocked starts go back; never the location. Each call can cost Distance Matrix
// lookups (at most two per located commitment in the window), hence the rate limit.

import { getAvailabilityConfig } from "@/features/booking/lib/availability-config.server";
import { BOOKING_FIELD_LIMITS, bookingWindowEnd } from "@/features/booking/lib/booking";
import {
  findTravelBlockedSlots,
  loadCurrentSpot,
  loadTravelTimeline,
} from "@/features/booking/lib/booking-travel.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/booking/travel-slots - the grid starts an address can't reach in time.
 * @param request - Body: `{ address: string }`.
 * @returns `{ ok: true, blocked }` (empty when nothing is ruled out), or 400 when the address is
 *   missing.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "booking-travel-slots", 10, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as { address?: unknown } | null;
  const raw = body?.address;
  if (typeof raw !== "string" || !raw.trim() || raw.length > BOOKING_FIELD_LIMITS.address) {
    return errorResponse("address is required", 400);
  }

  try {
    const now = new Date();
    const { config, acceptingBookings } = await getAvailabilityConfig();
    if (!acceptingBookings) return okResponse({ blocked: [] });
    const [timeline, here] = await Promise.all([
      loadTravelTimeline(now, bookingWindowEnd(now, config), config),
      loadCurrentSpot(now),
    ]);
    const blocked = await findTravelBlockedSlots(raw.trim(), timeline, now, config, here);
    return okResponse({ blocked });
  } catch (error) {
    // The form keeps every time open; the submit re-check still applies.
    console.error("[booking/travel-slots] Error:", error);
    return errorResponse("Couldn't check travel times.", 500);
  }
}
