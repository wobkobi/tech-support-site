// src/app/api/admin/contacts/verify-address/route.ts
// Admin address verification for the review queue: public geocoding without its rate limit.

import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { geocodeAddressCandidates } from "@/shared/lib/normalise-address";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/contacts/verify-address - Geocode a typed address to confident NZ candidates.
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
