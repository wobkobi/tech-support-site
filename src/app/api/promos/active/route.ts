// src/app/api/promos/active/route.ts
// Public active-promo endpoint for the estimators. Resolved live (not cached) so a
// capped promo stops pricing estimates.

import { resolvePromo } from "@/features/business/lib/promos";
import { parseDate, parseString } from "@/features/business/lib/validation";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/promos/active - Public, returns the automatic promo an anonymous visitor would
 * get right now, or null. With no slot yet, the best promo without a weekday/time restriction
 * wins; a restricted one comes back only when nothing else applies, for the caller to judge
 * once a slot is picked.
 * @param request - Incoming request, for the rate limit.
 * @returns JSON with the promo or null.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Each call reads the database; the estimator asks once per page, so this only stops a flood.
  const limited = rateLimitOrReject(request, "promo-active-get", 30, 60_000);
  if (limited) return limited;
  const promo = await resolvePromo({ at: null, bookedAt: new Date() });
  return NextResponse.json({ ok: true, promo });
}

/**
 * POST /api/promos/active - The automatic promo for a slot and email, as the booking
 * will resolve it. Rate limited: the answer reveals whether an email has booked before.
 * @param request - Incoming request with `{ startAt?, email? }`.
 * @returns JSON with the promo or null, and whether the customer was judged.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "promo-active", 10, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const email = parseString(body?.email, 254);
  const promo = await resolvePromo({
    at: parseDate(body?.startAt),
    bookedAt: new Date(),
    email,
  });
  return NextResponse.json({ ok: true, promo, customerChecked: email != null });
}
