// src/app/api/cron/refresh-calendar-cache/route.ts
/**
 * @file route.ts
 * @description Cron endpoint to refresh cached calendar events.
 *
 * Configured in vercel.json with path "/api/cron/refresh-calendar-cache"
 * and a schedule of every 10 minutes.
 */

import { NextRequest, NextResponse } from "next/server";
import { refreshCalendarCache } from "@/lib/calendar-cache";

/**
 * Verify the request is from Vercel Cron or has the correct secret.
 * @param request - The incoming request to verify.
 * @returns True if authorized, false otherwise.
 */
function isAuthorized(request: NextRequest): boolean {
  // Vercel Cron sends this header
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // If no secret is configured, only allow from Vercel Cron
  if (!cronSecret) {
    return request.headers.has("x-vercel-cron");
  }

  // Check both Vercel Cron header and Bearer token
  return request.headers.has("x-vercel-cron") || authHeader === `Bearer ${cronSecret}`;
}

/**
 * GET /api/cron/refresh-calendar-cache
 * Fetches calendar events and caches them in the database.
 * @param request - The incoming cron request.
 * @returns JSON response with cache refresh results.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
