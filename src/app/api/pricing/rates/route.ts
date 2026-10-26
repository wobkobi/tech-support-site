// src/app/api/pricing/rates/route.ts
// Public rates endpoint (no auth): hourly rates and the customer-facing modifiers only.

import { getRateRows, toPublicRates } from "@/features/business/lib/pricing-policy.server";
import { NextResponse } from "next/server";

/**
 * GET /api/pricing/rates - served from tag-cached rate rows, so warm requests skip Mongo.
 * Admin-only modifiers (Business) never leave the server.
 * @returns JSON with the public rates array.
 */
export async function GET(): Promise<NextResponse> {
  const rates = await getRateRows();
  return NextResponse.json({ ok: true, rates: toPublicRates(rates) });
}
