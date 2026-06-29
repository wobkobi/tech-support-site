// src/app/api/promos/active/route.ts
/**
 * @description Public active-promo endpoint. GET returns the currently active
 * promo via {@link getActivePromo}, or null when none applies.
 */

import { getActivePromo } from "@/features/business/lib/promos";
import { NextResponse } from "next/server";

/**
 * GET /api/promos/active - Public, returns the active promo or null.
 * @returns JSON with the active promo or null.
 */
export async function GET(): Promise<NextResponse> {
  const promo = await getActivePromo();
  return NextResponse.json({ ok: true, promo });
}
