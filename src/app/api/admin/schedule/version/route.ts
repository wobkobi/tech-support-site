// src/app/api/admin/schedule/version/route.ts
// Change-detection endpoint for the admin schedule's auto-refresh: returns a
// token fingerprinting the calendar events in a window so the client can skip
// router.refresh() when nothing has moved. See docs/CRON.md for the wider
// function-CPU budget this serves.

import { scheduleEventsToken } from "@/features/admin/lib/schedule-token";
import { getCachedScheduleEvents } from "@/features/calendar/lib/google-calendar";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;
// The response must never be cached: the whole job is observing the underlying
// event cache move, and a cached token would pin the grid to stale data.
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/schedule/version?from=<iso>&to=<iso>
 * Fingerprints the calendar events in the window. `from`/`to` must be the exact
 * ISO strings the page rendered with - they form the underlying cache key, so a
 * different window yields a token that can never agree with the page's.
 * @param request - Incoming Next.js request.
 * @returns JSON with `{ ok: true, token }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
    return errorResponse("from and to must both be ISO 8601 timestamps", 400);
  }

  try {
    const events = await getCachedScheduleEvents(from, to);
    return NextResponse.json({ ok: true, token: scheduleEventsToken(events) });
  } catch (err) {
    console.error("[schedule/version] failed:", err);
    return errorResponse("Could not read schedule state", 502);
  }
}
