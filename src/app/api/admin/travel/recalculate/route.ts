// src/app/api/admin/travel/recalculate/route.ts
// Admin endpoint to recalculate travel for every event still to finish. Finished jobs keep
// the travel they had, and a failed lookup keeps the block it would have replaced.

import { refreshCalendarCache } from "@/features/calendar/lib/calendar-cache";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Runs a full calendar cache refresh that recomputes upcoming travel from fresh lookups.
 * @param request - Incoming admin request.
 * @returns JSON `{ ok, cachedCount, failedCalendars }`, or an error when the calendars
 * couldn't be read at all.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const result = await refreshCalendarCache({ forceTravel: true });
    if (result.fetchFailed) {
      return errorResponse(
        "Couldn't read Google Calendar, so nothing was recalculated. Try again in a minute.",
        502,
      );
    }
    return NextResponse.json({
      ok: true,
      cachedCount: result.cachedCount,
      failedCalendars: result.failedCalendars,
    });
  } catch (error) {
    console.error("[travel/recalculate] Error:", error);
    return errorResponse("Recalculation failed", 500);
  }
}
