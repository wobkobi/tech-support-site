// src/app/api/pricing/rates/route.ts
// Public rates endpoint (no auth): hourly rates and the customer-facing modifiers only.

import { getRateRows, toPublicRates } from "@/features/business/lib/pricing-policy.server";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/pricing/rates - served from tag-cached rate rows, so warm requests skip Mongo.
 * Admin-only modifiers (Business) never leave the server.
 * @param request - Incoming request, for the per-IP limit.
 * @returns JSON with the public rates array.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "pricing-rates", 60, 60_000);
  if (limited) return limited;
  const rates = await getRateRows();
  return NextResponse.json({ ok: true, rates: toPublicRates(rates) });
}
