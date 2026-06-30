// src/app/api/cron/purge-price-estimates/route.ts
/**
 * @description Cron endpoint to delete PriceEstimateLog rows older than 30 days.
 * Called externally via cron-job.org (daily cadence).
 */

import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorized } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/cron/purge-price-estimates
 * Deletes price estimate logs older than the retention window.
 * @param request - The incoming cron request.
 * @returns JSON response with deleted count.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const { comms } = await getSettings();
    const cutoff = new Date(Date.now() - comms.priceEstimateRetentionDays * 24 * 60 * 60 * 1000);
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
