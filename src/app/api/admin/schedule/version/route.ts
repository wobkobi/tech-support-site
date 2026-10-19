// src/app/api/admin/schedule/version/route.ts
// Change detection for the schedule's auto-refresh: a fingerprint of the window's events.
// Reads Google live, busting the cache only on a real change (a cached read rewrote it every poll).

import { scheduleEventsToken } from "@/features/admin/lib/schedule-token";
import {
  fetchAllCalendarEvents,
  SCHEDULE_CALENDAR_TAG,
} from "@/features/calendar/lib/google-calendar";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

// Never cache the response, or the token pins the grid to stale data.
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/schedule/version?from=<iso>&to=<iso>&token=<seen>
 * Fingerprints the window's events. `from`/`to` must match the page's cache key exactly;
 * when the live token differs from `token`, the schedule cache is busted.
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
