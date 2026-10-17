// src/app/api/admin/schedule/version/route.ts
// Change-detection endpoint for the admin schedule's auto-refresh: returns a
// token fingerprinting the calendar events in a window so the client can skip
// router.refresh() when nothing has moved. See docs/CRON.md for the wider
// function-CPU budget this serves.
//
// Reads Google live rather than through getCachedScheduleEvents: the poll runs every
// 60s against a 30s cache, so a cached read rewrote the ~26 KB entry (4 billed ISR
// write units) on every tick. Instead the cache is only busted when the live token
// differs from the one the client was rendered with, so the refresh that follows
// renders fresh data and writes the entry once per real change.

import { scheduleEventsToken } from "@/features/admin/lib/schedule-token";
import {
  fetchAllCalendarEvents,
  SCHEDULE_CALENDAR_TAG,
} from "@/features/calendar/lib/google-calendar";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

// The response must never be cached: the whole job is observing the underlying
// event cache move, and a cached token would pin the grid to stale data.
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/schedule/version?from=<iso>&to=<iso>&token=<seen>
 * Fingerprints the calendar events in the window. `from`/`to` must be the exact
 * ISO strings the page rendered with - they form the page's cache key, so a
 * different window yields a token that can never agree with the page's. `token` is
 * the fingerprint the client currently shows; when the live one differs, the
 * schedule cache is busted so the client's refresh doesn't render the old entry.
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
    const events = await fetchAllCalendarEvents(new Date(from), new Date(to));
    const token = scheduleEventsToken(events);
    const seen = request.nextUrl.searchParams.get("token");
    if (seen !== null && seen !== token) revalidateTag(SCHEDULE_CALENDAR_TAG, {});
    return NextResponse.json({ ok: true, token });
  } catch (err) {
    console.error("[schedule/version] failed:", err);
    return errorResponse("Could not read schedule state", 502);
  }
}
