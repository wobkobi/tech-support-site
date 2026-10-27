// src/app/api/cron/refresh-calendar-cache/route.ts
// Cron (every 30 min) refreshing the calendar cache behind booking-page availability.
// The admin schedule reads Google live, so it doesn't depend on this.

import { refreshCalendarCache } from "@/features/calendar/lib/calendar-cache";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

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
    // A failed read keeps the stale cache, but cron-job.org should still see the failure.
    if (result.fetchFailed) {
      return NextResponse.json(
        { ok: false, error: "Couldn't read the calendars; the cache was left as it was" },
        { status: 502 },
      );
    }

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
