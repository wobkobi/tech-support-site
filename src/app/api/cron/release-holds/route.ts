// src/app/api/cron/release-holds/route.ts
/**
 * @file route.ts
 * @description Cron endpoint to release expired booking holds.
 * Called externally via cron-job.org every 15 minutes.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
    const now = new Date();
    const expired = await prisma.booking.findMany({
      where: {
        status: "held",
        holdExpiresUtc: { lte: now },
      },
      select: { id: true },
    });

    const ids = expired.map((b) => b.id);

    if (ids.length > 0) {
      await prisma.booking.updateMany({
        where: { id: { in: ids } },
        data: { status: "cancelled" },
      });
    }

    return NextResponse.json({
      ok: true,
      releasedCount: ids.length,
      releasedIds: ids,
    });
  } catch (error) {
    console.error("[cron/release-holds] Error:", error);
    return NextResponse.json({ ok: false, error: "Failed to release holds" }, { status: 500 });
  }
}
