// src/app/api/promos/active/route.ts
import { NextResponse } from "next/server";
import { getActivePromo } from "@/features/business/lib/promos";

/**
 * GET /api/promos/active - Public, returns the active promo or null.
 * @returns JSON with the active promo or null.
 */
export async function GET(): Promise<NextResponse> {
  const promo = await getActivePromo();
  return NextResponse.json({ ok: true, promo });
}
