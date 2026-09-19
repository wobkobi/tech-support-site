// src/app/api/promos/validate/route.ts
// Checks a customer-entered promo code. Public, because the booking form and the pricing
// wizard both need it before anyone has identified themselves - which is also why it is
// rate limited.

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
 * POST /api/promos/validate - Reports whether a code is currently usable.
 *
 * Answers only valid/invalid plus the offer's wording. It never names the
 * promo's other terms, so the endpoint cannot be walked to enumerate what
 * codes exist.
 * Returns the resolved promo on a hit so the caller can price with it right
 * away rather than asking for it again. Nothing is disclosed without a correct
 * code, so this adds no enumeration surface.
 *
 * The chosen slot and the email being booked with are optional. Sent, they
 * judge the code exactly as the booking will: a Tuesday-only code against the
 * slot, a new-customers-only code against the customer. Without a slot the
 * weekday restriction is not judged here, and the booking form gates the
 * figures on the slot once one is picked.
 * @param request - Incoming request with `{ code, startAt?, email? }`.
 * @returns JSON with validity, a customer-facing description, and the promo.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Public and unauthenticated, so guessing codes is the obvious abuse. A
  // customer types one code and maybe corrects a typo, so a tight limit costs
  // real use nothing.
  const limited = rateLimitOrReject(request, "promo-validate", 10, 60_000);
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const normalised = normalisePromoCode(parseString(body?.code, 64));
  if (!normalised) {
    return NextResponse.json({ ok: true, valid: false, description: null, promo: null });
  }

  // Resolved through the same function that prices the booking, so a code
  // cannot validate here and then fail to apply at checkout. resolvePromo
  // falls back to the automatic promo when the code misses, so compare the
  // code back: a fallback is not a valid code. The dates are judged now, since
  // a booking made from this form is made now.
  const promo = await resolvePromo({
    code: normalised,
    at: parseDate(body?.startAt),
    bookedAt: new Date(),
    email: parseString(body?.email, 254),
  });
  const valid = promo?.code === normalised;
  // The spend floor and any weekday restriction go with the offer, so an
  // accepted code does not read as unconditional when it is not.
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
