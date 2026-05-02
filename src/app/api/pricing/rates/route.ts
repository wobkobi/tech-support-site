import { NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";

/**
 * GET /api/pricing/rates - Public endpoint returning rate labels and amounts (no auth required).
 * @returns JSON with public rates array stripped of internal fields
 */
export async function GET(): Promise<NextResponse> {
  const rates = await prisma.rateConfig.findMany({ orderBy: { label: "asc" } });

  const publicRates = rates.map(({ label, ratePerHour, flatRate, unit, isDefault }) => ({
    label,
    ratePerHour,
    flatRate,
    unit,
    isDefault,
  }));

  return NextResponse.json({ ok: true, rates: publicRates });
}
