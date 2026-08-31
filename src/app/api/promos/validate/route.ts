// src/app/api/promos/validate/route.ts
/**
 * @description Checks a customer-entered promo code. Public, because the
 * booking form and the pricing wizard both need it before anyone has
 * identified themselves - which is also why it is rate limited.
 */

import {
  describePromoDiscount,
  normalisePromoCode,
  resolvePromo,
} from "@/features/business/lib/promos";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/promos/validate - Reports whether a code is currently usable.
 *
 * Answers only valid/invalid plus the offer's wording. It never names the
 * promo's other terms, so the endpoint cannot be walked to enumerate what
 * codes exist.
 * @param request - Incoming request with `{ code }`.
 * @returns JSON with validity and a customer-facing description.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Public and unauthenticated, so guessing codes is the obvious abuse. A
  // customer types one code and maybe corrects a typo, so a tight limit costs
  // real use nothing.
  const limited = rateLimitOrReject(request, "promo-validate", 10, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const normalised = normalisePromoCode(body?.code);
  if (!normalised) {
    return NextResponse.json({ ok: true, valid: false, description: null });
  }

  // Resolved through the same function that prices the booking, so a code
  // cannot validate here and then fail to apply at checkout. resolvePromo
  // falls back to the automatic promo when the code misses, so compare the
  // code back: a fallback is not a valid code.
  const promo = await resolvePromo({ code: normalised });
  const valid = promo?.code === normalised;
  return NextResponse.json({
    ok: true,
    valid,
    description: valid && promo ? describePromoDiscount(promo) : null,
  });
}
