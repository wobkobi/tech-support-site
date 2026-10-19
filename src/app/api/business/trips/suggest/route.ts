// src/app/api/business/trips/suggest/route.ts
// Admin "jobs without a trip" endpoint: past in-person bookings in an FY with no trip
// yet, with a km prefill from earlier trips to the same address.

import { fyKeyOf } from "@/features/business/lib/financial-year";
import { loadAllFys } from "@/features/business/lib/tax/load";
import { pickFy } from "@/features/business/lib/trips";
import { loadTripSuggestions } from "@/features/business/lib/trips.server";
import { errorResponse, noStore } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/business/trips/suggest - Jobs in the FY that still need a trip.
 * @param request - Incoming Next.js request (`?fy=` optional).
 * @returns JSON with the FY key and the suggestions array.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return noStore(errorResponse("Unauthorized", 401));
  }

  const now = new Date();
  const fy = pickFy(await loadAllFys(now), request.nextUrl.searchParams.get("fy") ?? undefined);
  if (!fy) return noStore(errorResponse("Unknown financial year", 404));

  const suggestions = await loadTripSuggestions(fy, now);
  return noStore(NextResponse.json({ ok: true, fyKey: fyKeyOf(fy.label), suggestions }));
}
