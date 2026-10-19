// src/app/api/promos/validate/route.ts
// Check a customer-entered promo code. Public (used before sign-in), so rate limited.

import {
  describePromoOffer,
  describeRecurringWindow,
  normalisePromoCode,
  resolvePromo,
} from "@/features/business/lib/promos";
import { parseDate, parseString } from "@/features/business/lib/validation";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/promos/validate - report whether a code is usable; the promo is returned
 * only on a hit, so nothing enables enumeration. Optional slot and email judge it as
 * the booking will; without a slot the weekday restriction is left to the form.
 * @param request - Incoming request with `{ code, startAt?, email? }`.
 * @returns JSON with validity, a customer-facing description, and the promo.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Tight limit against code guessing; real use is one code plus a typo fix.
  const limited = rateLimitOrReject(request, "promo-validate", 10, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const normalised = normalisePromoCode(parseString(body?.code, 64));
  if (!normalised) {
    return NextResponse.json({ ok: true, valid: false, description: null, promo: null });
  }

  // Same resolver as the booking. It falls back to the automatic promo on a miss,
  // so compare the code back: a fallback is not a valid code.
  const promo = await resolvePromo({
    code: normalised,
    at: parseDate(body?.startAt),
    bookedAt: new Date(),
    email: parseString(body?.email, 254),
  });
  const valid = promo?.code === normalised;
  // Show the spend floor and weekday restriction so the code doesn't read as unconditional.
  const restriction = valid && promo ? describeRecurringWindow(promo) : null;
  const description =
    valid && promo
      ? `${describePromoOffer(promo)}${restriction ? `, ${restriction} only` : ""}`
      : null;
  return NextResponse.json({
    ok: true,
    valid,
    description,
    promo: valid ? promo : null,
  });
}
