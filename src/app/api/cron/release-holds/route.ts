// src/app/api/cron/release-holds/route.ts
/**
 * @description Cron endpoint to release expired booking holds.
 * Called externally via cron-job.org every 15 minutes.
 */

import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorized } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/cron/release-holds
 * Releases expired booking holds.
 * @param request - The incoming cron request.
 * @returns JSON response with release results.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const now = new Date();
    const expired = await prisma.booking.findMany({
      where: {
        status: "held",
        holdExpiresAt: { lte: now },
      },
      select: { id: true },
    });

    const ids = expired.map((b) => b.id);

    if (ids.length > 0) {
      // Guard each release on status + expiry so a hold confirmed between the
      // findMany and this write (slow calendar-create straddling expiry) is not
      // clobbered back to cancelled. updateMany accepts the non-unique guard;
      // the per-id activeSlotKey stays unique to satisfy the slot constraint.
      await Promise.all(
        ids.map((id) =>
          prisma.booking.updateMany({
            where: { id, status: "held", holdExpiresAt: { lte: now } },
            data: { status: "cancelled", activeSlotKey: `released:${id}` },
          }),
        ),
      );
    }

    return NextResponse.json({
      ok: true,
      releasedCount: ids.length,
      releasedIds: ids,
    });
  } catch (error) {
    console.error("[cron/release-holds] Error:", error);
    return errorResponse("Failed to release holds", 500);
  }
}
