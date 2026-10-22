// src/app/api/admin/social/schedules/[id]/fill/route.ts
// Line up posts now: fills one schedule's empty slots straight away instead of waiting for the
// hourly fill. With redo, its lined-up postings are cleared first and picked again.

import { parseObjectId } from "@/features/business/lib/validation";
import { fillQueues } from "@/features/social/lib/queue-fill.server";
import { redoQueue } from "@/features/social/lib/queues.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

const BUSY = "Posts are being lined up already. Try again in a minute.";

/**
 * POST /api/admin/social/schedules/[id]/fill
 * Body: `{ redo?: boolean }`.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the schedule id.
 * @returns JSON `{ cleared, fill }`, or 409 while another fill runs.
 */
export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("That schedule has been deleted.", 404);
  const body = (await request.json().catch(() => null)) as { redo?: unknown } | null;
  const queue = await prisma.socialQueue.findUnique({ where: { id }, select: { paused: true } });
  if (!queue) return errorResponse("That schedule has been deleted.", 404);
  if (queue.paused) return errorResponse("It's paused. Turn it back on to line up posts.", 409);

  try {
    const { social } = await getSettings();
    const now = new Date();
    const fillDays = social.schedules.fillDays;
    if (body?.redo === true) {
      const done = await redoQueue(id, now, fillDays);
      if (!done) return errorResponse("That schedule has been deleted.", 404);
      if (!done.fill) return errorResponse(BUSY, 409);
      return okResponse({ cleared: done.cleared, fill: done.fill });
    }
    const fill = await fillQueues({ now, fillDays, queueIds: [id] });
    if (!fill) return errorResponse(BUSY, 409);
    return okResponse({ cleared: 0, fill });
  } catch (error) {
    console.error("[admin/social/schedules/fill] Fill failed:", error);
    return errorResponse("Couldn't line up posts. Try again.", 500);
  }
}
