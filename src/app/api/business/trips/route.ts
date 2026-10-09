// src/app/api/business/trips/route.ts
// Admin trip-log collection endpoint (site-only, no Sheets sync). GET lists trips newest
// first, scoped to one FY with ?fy=2026-27 or all trips without it; POST validates and
// logs a trip, refusing a second trip for the same booking (one round trip per job).

import { loadAllFys } from "@/features/business/lib/tax/load";
import { parseTripInput, pickFy, toTripRow } from "@/features/business/lib/trips";
import { loadTrips, TRIP_SELECT } from "@/features/business/lib/trips.server";
import { errorResponse, noStore } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/business/trips - Lists trips, newest first, optionally for one FY.
 * @param request - Incoming Next.js request (`?fy=` optional).
 * @returns JSON with the trips array.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return noStore(errorResponse("Unauthorized", 401));
  }

  const fyKey = request.nextUrl.searchParams.get("fy");
  let window: { start: Date; end: Date } | null = null;
  if (fyKey) {
    const fy = pickFy(await loadAllFys(new Date()), fyKey);
    if (!fy) return noStore(errorResponse("Unknown financial year", 404));
    window = { start: fy.start, end: fy.end };
  }

  const trips = await loadTrips(window);
  return noStore(NextResponse.json({ ok: true, trips }));
}

/**
 * POST /api/business/trips - Logs a trip, optionally linked to the booking it came from.
 * @param request - Incoming Next.js request with the trip in the body.
 * @returns JSON with the created trip.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return noStore(errorResponse("Unauthorized", 401));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore(errorResponse("Invalid JSON body", 400));
  }
  const parsed = parseTripInput(body);
  if (!parsed.ok) return noStore(errorResponse(parsed.error, 400));

  const { bookingId } = parsed.value;
  if (bookingId) {
    const [booking, existing] = await Promise.all([
      prisma.booking.findUnique({ where: { id: bookingId }, select: { id: true } }),
      prisma.trip.findFirst({ where: { bookingId }, select: { id: true } }),
    ]);
    if (!booking) return noStore(errorResponse("Booking not found", 404));
    // Travel is one round trip per job, so a booking gets one trip.
    if (existing) return noStore(errorResponse("A trip is already logged for this job", 409));
  }

  const trip = await prisma.trip.create({ data: parsed.value, select: TRIP_SELECT });
  return noStore(NextResponse.json({ ok: true, trip: toTripRow(trip) }, { status: 201 }));
}
