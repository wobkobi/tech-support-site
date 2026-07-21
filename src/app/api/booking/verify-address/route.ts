// src/app/api/booking/verify-address/route.ts
/**
 * @description Public, rate-limited address verification endpoint. POST geocodes
 * a typed address via {@link geocodeAddressCandidates} and returns the confident
 * NZ candidates so the booking form can let the customer disambiguate when the
 * input matches more than one place (0 = not found, 1 = unambiguous, >1 =
 * ambiguous). Each request costs one Google Geocoding call; the rate limit keeps
 * that within quota.
 */

import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { geocodeAddressCandidates } from "@/shared/lib/normalise-address";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow Google Geocoding call cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/booking/verify-address - Geocode a typed address to confident NZ
 * candidates for the client "did you mean?" / disambiguation prompt.
 * @param request - Body: `{ address: string }`.
 * @returns `{ ok: true, candidates: string[] }` (empty when unresolvable), or
 *   `{ ok: false, error }` with 400 when the address is missing.
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
