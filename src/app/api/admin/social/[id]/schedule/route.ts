// src/app/api/admin/social/[id]/schedule/route.ts
// Schedules a draft for the publish-scheduled cron, or cancels back to a draft. Quiet hours don't
// apply. Cancelling a schedule's posting takes it out of the schedule and leaves its slot empty.

import { parseObjectId } from "@/features/business/lib/validation";
import { NOT_CONTENT } from "@/features/social/lib/filters";
import { scheduleProblems } from "@/features/social/lib/publish";
import { skipQueueSlot } from "@/features/social/lib/queue-fill.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/social/[id]/schedule
 * Body: `{ scheduledAt: ISO string }`.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the post id.
 * @returns JSON `{ scheduledAt }`.
 */
export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Post not found.", 404);
  const body = (await request.json().catch(() => null)) as { scheduledAt?: unknown } | null;

  const when = typeof body?.scheduledAt === "string" ? new Date(body.scheduledAt) : null;
  if (!when || Number.isNaN(when.getTime())) return errorResponse("Pick a date and time.", 400);
  if (when.getTime() < Date.now() + 60_000) {
    return errorResponse("Pick a time at least a minute from now.", 400);
  }

  const post = await prisma.socialPost.findUnique({ where: { id } });
  if (!post || post.isPreset) return errorResponse("Post not found.", 404);
  if (post.isContent) {
    return errorResponse("A content item is scheduled as a posting, from its own page.", 400);
  }
  const problem = scheduleProblems(post);
  if (problem) return errorResponse(problem.error, problem.status);

  const updated = await prisma.socialPost.updateMany({
    where: { id, isPreset: false, status: "draft", ...NOT_CONTENT },
    data: { status: "scheduled", scheduledAt: when },
  });
  if (updated.count === 0) return errorResponse("Only a draft can be scheduled.", 409);
  return okResponse({ scheduledAt: when.toISOString() });
}

/**
 * DELETE /api/admin/social/[id]/schedule - cancels a schedule.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the post id.
 * @returns JSON `{ ok }`.
 */
export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Post not found.", 404);
  const post = await prisma.socialPost.findUnique({
    where: { id },
    select: { queueId: true, scheduledAt: true },
  });
  const updated = await prisma.socialPost.updateMany({
    where: { id, status: "scheduled" },
    data: { status: "draft", scheduledAt: null, queueId: null },
  });
  if (updated.count === 0) {
    return errorResponse("It isn't scheduled any more - it may have just started posting.", 409);
  }
  if (post?.queueId && post.scheduledAt) await skipQueueSlot(post.queueId, post.scheduledAt);
  return okResponse();
}
