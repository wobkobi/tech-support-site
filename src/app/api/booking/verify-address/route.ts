// src/app/api/booking/verify-address/route.ts
// Public address check: returns confident NZ candidates so the booking form can
// disambiguate. Each call costs one Google Geocoding request, hence the rate limit.

import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { geocodeAddressCandidates } from "@/shared/lib/normalise-address";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/booking/verify-address - geocode a typed address to NZ candidates.
 * @param request - Body: `{ address: string }`.
 * @returns `{ ok: true, candidates }` (empty when unresolvable), or 400 when missing.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "verify-address", 10, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as { address?: unknown } | null;
  const raw = body?.address;

  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return errorResponse("address is required", 400);
  }

  const candidates = await geocodeAddressCandidates(raw);
  return okResponse({ candidates });
}
