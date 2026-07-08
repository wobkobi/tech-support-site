// src/app/api/pricing/rates/route.ts
/**
 * @description Public rates endpoint (no auth). GET returns the rate configs
 * stripped to the customer-safe fields (label, ratePerHour, flatRate,
 * hourlyDelta, unit, isDefault), ordered by label.
 */

import { getRateRows } from "@/features/business/lib/pricing-policy.server";
import { NextResponse } from "next/server";

/**
 * GET /api/pricing/rates - Public endpoint returning rate labels and amounts (no auth required).
 * Served from the tag-cached rate rows, so it skips Mongo on warm requests.
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
