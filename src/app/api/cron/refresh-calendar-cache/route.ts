// src/app/api/cron/refresh-calendar-cache/route.ts
/**
 * @description Cron endpoint to refresh cached calendar events.
 * Called externally via cron-job.org every 30 minutes. The cache backs
 * booking-page availability; the admin schedule reads Google live through
 * getCachedScheduleEvents, so it stays current regardless of this cadence.
 */

import { refreshCalendarCache } from "@/features/calendar/lib/calendar-cache";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/cron/refresh-calendar-cache
 * Fetches calendar events and caches them in the database.
 * @param request - The incoming cron request.
 * @returns JSON response with cache refresh results.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const result = await refreshCalendarCache();

    return NextResponse.json({
      ok: true,
      cachedCount: result.cachedCount,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("[cron/refresh-calendar-cache] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to refresh calendar cache" },
      { status: 500 },
    );
  }
}
