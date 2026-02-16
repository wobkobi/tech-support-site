// src/app/api/cron/release-holds/route.ts
/**
 * @file route.ts
 * @description Cron endpoint to release expired booking holds.
 *
 * Configure in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/release-holds",
 *     "schedule": "*/ 5; /* /* /* /*"
 *   }]
 * }
 *
 * This runs every 5 minutes to clean up stale holds.
 */

import { NextRequest, NextResponse } from "next/server";
import { releaseExpiredHolds } from "@/lib/releaseExpiredHolds";

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
 * GET /api/cron/release-holds
 * Releases expired booking holds.
 * @param request - The incoming cron request.
 * @returns JSON response with release results.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await releaseExpiredHolds();

    return NextResponse.json({
      ok: true,
      releasedCount: result.releasedCount,
      releasedIds: result.releasedIds,
    });
  } catch (error) {
    console.error("[cron/release-holds] Error:", error);
    return NextResponse.json({ ok: false, error: "Failed to release holds" }, { status: 500 });
  }
}
