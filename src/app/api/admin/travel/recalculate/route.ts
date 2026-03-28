// src/app/api/admin/travel/recalculate/route.ts
/**
 * @file route.ts
 * @description Admin endpoint to force-recalculate all travel blocks.
 * Clears stored TravelBlock records so the next cache refresh recomputes fresh travel times.
 */

import { type NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { refreshCalendarCache } from "@/features/calendar/lib/calendar-cache";

/**
 * Force-deletes all TravelBlock records and runs a full calendar cache refresh
 * so stale travel times are replaced with freshly-fetched values.
 * @param request - Incoming admin request.
 * @returns JSON with ok and cachedCount, or an error response.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await prisma.travelBlock.deleteMany({});
    const result = await refreshCalendarCache();
    return NextResponse.json({ ok: true, cachedCount: result.cachedCount });
  } catch (error) {
    console.error("[travel/recalculate] Error:", error);
    return NextResponse.json({ ok: false, error: "Recalculation failed" }, { status: 500 });
  }
}
