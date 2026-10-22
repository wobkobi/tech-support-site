// src/app/api/admin/social/schedules/[id]/route.ts
// One schedule: read it, change it (clearing lined-up postings that no longer fit and filling
// again), or delete it with its lined-up postings.

import { parseObjectId } from "@/features/business/lib/validation";
import { parseQueueInput } from "@/features/social/lib/queues";
import { deleteQueue, loadQueueEditor, updateQueue } from "@/features/social/lib/queues.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

const GONE = "That schedule has been deleted.";

/**
 * GET /api/admin/social/schedules/[id]
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the schedule id.
 * @returns JSON `{ schedule, upcoming, linedUp }`.
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse(GONE, 404);
  const { social } = await getSettings();
  const data = await loadQueueEditor(id, new Date(), social.schedules.fillDays);
  if (!data?.row) return errorResponse(GONE, 404);
  return okResponse({ schedule: data.row, upcoming: data.upcoming, linedUp: data.linedUp });
}

/**
 * PATCH /api/admin/social/schedules/[id]
 * Body: any of the schedule's fields.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the schedule id.
 * @returns JSON `{ schedule, cleared, fill }`; fill is null while paused or another fill runs.
 */
export async function PATCH(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse(GONE, 404);
  const parsed = parseQueueInput(await request.json().catch(() => null), true);
  if ("error" in parsed) return errorResponse(parsed.error, 400);
  try {
    const { social } = await getSettings();
    const saved = await updateQueue(id, parsed.data, new Date(), social.schedules.fillDays);
    if (!saved) return errorResponse(GONE, 404);
    return okResponse({ schedule: saved.row, cleared: saved.cleared, fill: saved.fill });
  } catch (error) {
    console.error("[admin/social/schedules] Update failed:", error);
    return errorResponse("Couldn't save the schedule. Reload the page and try again.", 500);
  }
}

/**
 * DELETE /api/admin/social/schedules/[id]
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the schedule id.
 * @returns JSON `{ cleared }`, the lined-up postings deleted with it.
 */
export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse(GONE, 404);
  try {
    const cleared = await deleteQueue(id);
    if (cleared === null) return errorResponse(GONE, 404);
    return okResponse({ cleared });
  } catch (error) {
    console.error("[admin/social/schedules] Delete failed:", error);
    return errorResponse("Couldn't delete the schedule. Try again.", 500);
  }
}
