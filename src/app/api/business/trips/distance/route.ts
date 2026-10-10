// src/app/api/business/trips/distance/route.ts
// Admin Google km lookup for the trip form. POST takes an address and returns the
// round-trip driving km from the base address (there plus back) via driveRoundTripKm.
// Each call costs two Google Distance Matrix elements, so it only runs when the operator
// asks, and is rate limited in case a script or a stuck button repeats it.

import { driveRoundTripKm } from "@/features/business/lib/trips.server";
import { errorResponse, noStore, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/** Same cap as the booking address field. */
const MAX_ADDRESS_LEN = 250;

/**
 * POST /api/business/trips/distance - Round-trip driving km to an address.
 * @param request - Body: `{ address: string }`.
 * @returns `{ ok: true, km }`, 404 when Google can't find the address, 503 when the base
 *   address or Maps key is missing, 502 on an upstream failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return noStore(errorResponse("Unauthorized", 401));
  }
  const limited = rateLimitOrReject(request, "trip-distance", 20, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as { address?: unknown } | null;
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  if (!address || address.length > MAX_ADDRESS_LEN) {
    return noStore(errorResponse(`Enter an address, up to ${MAX_ADDRESS_LEN} characters`, 400));
  }

  const result = await driveRoundTripKm(address);
  switch (result.status) {
    case "ok":
      return noStore(okResponse({ km: result.km }));
    case "no_match":
      return noStore(errorResponse("Google couldn't find a driving route to that address.", 404));
    case "misconfig":
      console.error("[trips/distance] Base address or Google Maps key is not set");
      return noStore(errorResponse("Google lookup isn't set up. Type the km instead.", 503));
    case "error":
      return noStore(errorResponse("Google lookup failed. Try again, or type the km.", 502));
  }
}
