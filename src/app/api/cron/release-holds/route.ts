// src/app/api/cron/release-holds/route.ts
/**
 * @file route.ts
 * @description Cron endpoint to release expired booking holds.
 * Called externally via cron-job.org every 15 minutes.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isCronAuthorized } from "@/shared/lib/auth";

/**
 * GET /api/cron/release-holds
 * Releases expired booking holds.
 * @param request - The incoming cron request.
 * @returns JSON response with release results.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const expired = await prisma.booking.findMany({
      where: {
        status: "held",
        holdExpiresUtc: { lte: now },
      },
      select: { id: true },
    });

    const ids = expired.map((b) => b.id);

    if (ids.length > 0) {
      await prisma.booking.updateMany({
        where: { id: { in: ids } },
        data: {
          status: "cancelled",
          activeSlotKey: null,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      releasedCount: ids.length,
      releasedIds: ids,
    });
  } catch (error) {
    console.error("[cron/release-holds] Error:", error);
    return NextResponse.json({ ok: false, error: "Failed to release holds" }, { status: 500 });
  }
}
