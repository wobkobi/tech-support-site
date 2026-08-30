// src/app/api/business/promos/stats/route.ts
/**
 * @description Per-promo redemption counts for the admin promos page. Rows
 * created by the backfill carry no discount value, so they are counted
 * separately rather than folded into the total as zeroes - otherwise a promo
 * whose value was never recorded reads as one that saved nobody anything.
 */

import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/** Redemption totals for one promo. */
interface PromoStats {
  redemptions: number;
  totalDiscount: number;
  unvaluedRedemptions: number;
  lastRedeemedAt: string | null;
}

/**
 * GET /api/business/promos/stats - Redemption stats keyed by promo id.
 * @param request - Incoming request.
 * @returns JSON with the stats map.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const rows = await prisma.promoRedemption.findMany({
    select: { promoId: true, discountValue: true, redeemedAt: true },
  });

  const stats: Record<string, PromoStats> = {};

  for (const row of rows) {
    const entry = (stats[row.promoId] ??= {
      redemptions: 0,
      totalDiscount: 0,
      unvaluedRedemptions: 0,
      lastRedeemedAt: null,
    });
    entry.redemptions++;
    if (row.discountValue === null) entry.unvaluedRedemptions++;
    else entry.totalDiscount += row.discountValue;
    const iso = row.redeemedAt.toISOString();
    if (!entry.lastRedeemedAt || iso > entry.lastRedeemedAt) entry.lastRedeemedAt = iso;
  }

  return NextResponse.json({ ok: true, stats });
}
