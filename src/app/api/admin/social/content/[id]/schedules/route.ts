// src/app/api/admin/social/content/[id]/schedules/route.ts
// Which schedules a content item is in. Saving takes it out of the others with its lined-up
// postings there, then fills each schedule that changed.

import { parseObjectId } from "@/features/business/lib/validation";
import { setItemQueues } from "@/features/social/lib/queues.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/admin/social/content/[id]/schedules
 * Body: `{ queueIds }`, every schedule the item should be in.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the content item id.
 * @returns JSON `{ added, removed, cleared, fill }`.
 */
export async function PUT(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("That content item no longer exists.", 404);
  const body = (await request.json().catch(() => null)) as { queueIds?: unknown } | null;
  if (!Array.isArray(body?.queueIds)) return errorResponse("queueIds must be a list.", 400);
  const queueIds = body.queueIds.map(parseObjectId);
  if (queueIds.some((q) => q === null)) return errorResponse("queueIds holds an invalid id.", 400);

  try {
    const { social } = await getSettings();
    const result = await setItemQueues(
      id,
      [...new Set(queueIds as string[])],
      new Date(),
      social.schedules.fillDays,
    );
    if (!result.ok) return errorResponse(result.error, result.status);
    return okResponse({
      added: result.added,
      removed: result.removed,
      cleared: result.cleared,
      fill: result.fill,
    });
  } catch (error) {
    console.error("[admin/social/content/schedules] Save failed:", error);
    return errorResponse("Couldn't change its schedules. Reload the page and try again.", 500);
  }
}
