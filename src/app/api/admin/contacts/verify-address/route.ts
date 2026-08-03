// src/app/api/admin/contacts/verify-address/route.ts
/**
 * @description Admin-side address verification for the contact address review
 * queue. Same geocoding as the public /api/booking/verify-address, but behind
 * admin auth instead of that route's 10-per-minute public rate limit, which an
 * operator working through a long queue would otherwise hit.
 */

import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { geocodeAddressCandidates } from "@/shared/lib/normalise-address";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow Google Geocoding call cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/admin/contacts/verify-address - Geocode a typed address to
 * confident NZ candidates so the operator can confirm it before saving.
 * Requires admin auth.
 * @param request - Body: `{ address: string }`.
 * @returns `{ ok: true, candidates: string[] }` (empty when unresolvable), or
 *   `{ ok: false, error }` with 400 when the address is missing.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = (await request.json().catch(() => null)) as { address?: unknown } | null;
  const raw = body?.address;

  if (!raw || typeof raw !== "string" || !raw.trim()) {
    return errorResponse("address is required", 400);
  }

  return okResponse({ candidates: await geocodeAddressCandidates(raw) });
}
