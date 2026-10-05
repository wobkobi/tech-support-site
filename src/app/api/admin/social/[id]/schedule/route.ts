// src/app/api/admin/social/[id]/schedule/route.ts
// Schedules a draft to post later (the publish-scheduled cron posts it), or cancels the
// schedule, which turns it back into an editable draft. Unlike email, a time inside quiet
// hours stays where it was put.

import { parseObjectId } from "@/features/business/lib/validation";
import { scheduleProblems } from "@/features/social/lib/publish";
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
  const problem = scheduleProblems(post);
  if (problem) return errorResponse(problem.error, problem.status);

  const updated = await prisma.socialPost.updateMany({
    where: { id, isPreset: false, status: "draft" },
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
  const updated = await prisma.socialPost.updateMany({
    where: { id, status: "scheduled" },
    data: { status: "draft", scheduledAt: null },
  });
  if (updated.count === 0) {
    return errorResponse("It isn't scheduled any more - it may have just started posting.", 409);
  }
  return okResponse();
}
