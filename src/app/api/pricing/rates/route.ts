// src/app/api/pricing/rates/route.ts
// Public rates endpoint (no auth): rate configs stripped to customer-safe fields.

import { getRateRows } from "@/features/business/lib/pricing-policy.server";
import { NextResponse } from "next/server";

/**
 * GET /api/pricing/rates - served from tag-cached rate rows, so warm requests skip Mongo.
 * @returns JSON with public rates array stripped of internal fields
 */
export async function GET(): Promise<NextResponse> {
  const rates = await getRateRows();

  const publicRates = rates.map(
    ({ label, ratePerHour, flatRate, hourlyDelta, unit, isDefault }) => ({
      label,
      ratePerHour,
      flatRate,
      hourlyDelta,
      unit,
      isDefault,
    }),
  );

  return NextResponse.json({ ok: true, rates: publicRates });
}
