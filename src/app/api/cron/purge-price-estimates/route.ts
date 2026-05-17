// src/app/api/cron/purge-price-estimates/route.ts
/**
 * @file route.ts
 * @description Cron endpoint to delete PriceEstimateLog rows older than 30 days.
 * Called externally via cron-job.org (daily cadence).
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isCronAuthorized } from "@/shared/lib/auth";

const RETENTION_DAYS = 30;

/**
 * GET /api/cron/purge-price-estimates
 * Deletes price estimate logs older than the retention window.
 * @param request - The incoming cron request.
 * @returns JSON response with deleted count.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await prisma.priceEstimateLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    return NextResponse.json({ ok: true, deletedCount: result.count });
  } catch (error) {
    console.error("[cron/purge-price-estimates] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to purge price estimates" },
      { status: 500 },
    );
  }
}
