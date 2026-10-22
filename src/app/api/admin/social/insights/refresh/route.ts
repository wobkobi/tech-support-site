// src/app/api/admin/social/insights/refresh/route.ts
// Refresh figures: reads one post's figures now, or runs the whole stats sync (account days
// included) for Analytics. Either is turned away within 10 minutes of the last read.

import { parseObjectId } from "@/features/business/lib/validation";
import {
  loadInsightsState,
  REFRESH_EVERY_MS,
  refreshPostInsights,
  syncInsights,
} from "@/features/social/lib/insights/sync.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

const BUSY = "Figures are being read already. Try again in a minute.";
const RECENT = "Figures were read under 10 minutes ago. Try again shortly.";

/**
 * POST /api/admin/social/insights/refresh
 * Body: `{ postId?: string }`.
 * @param request - Incoming request.
 * @returns JSON `{ result }` (null for one post), 429 when read under 10 minutes ago, or 409 while
 *   another read runs.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as { postId?: unknown } | null;
  const now = new Date();
  try {
    if (body?.postId !== undefined) {
      const postId = parseObjectId(body.postId);
      if (!postId) return errorResponse("That post has been deleted.", 404);
      const done = await refreshPostInsights(postId, now);
      if (done === "throttled") return errorResponse(RECENT, 429);
      if (done === "busy") return errorResponse(BUSY, 409);
      return okResponse({ result: null });
    }
    const { ranAt } = await loadInsightsState();
    if (ranAt && now.getTime() - Date.parse(ranAt) < REFRESH_EVERY_MS) {
      return errorResponse(RECENT, 429);
    }
    const result = await syncInsights(now, { forceDays: true });
    if (!result) return errorResponse(BUSY, 409);
    return okResponse({ result });
  } catch (error) {
    console.error("[admin/social/insights/refresh] failed:", error);
    return errorResponse("Couldn't read the figures. Try again.", 500);
  }
}
