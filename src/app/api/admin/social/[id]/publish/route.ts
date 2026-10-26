// src/app/api/admin/social/[id]/publish/route.ts
// Publishes a post to its platforms now, or re-posts only to the platforms that failed.
// Quiet hours don't apply: a post wakes nobody.

import { parseObjectId } from "@/features/business/lib/validation";
import { publishPost, retryFailed } from "@/features/social/lib/publish";
import { skipQueueSlot } from "@/features/social/lib/queue-fill.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/social/[id]/publish
 * Body: `{ mode: "now" | "retry" }`.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the post id.
 * @returns JSON `{ status, targets }`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Post not found.", 404);
  const body = (await request.json().catch(() => null)) as { mode?: string } | null;
  if (body?.mode !== "now" && body?.mode !== "retry") {
    return errorResponse('mode must be "now" or "retry".', 400);
  }

  try {
    if (body.mode === "retry") {
      const result = await retryFailed(id);
      return result.ok
        ? okResponse({ status: result.status, targets: result.targets })
        : errorResponse(result.error, result.status);
    }
    const slot = await prisma.socialPost.findUnique({
      where: { id },
      select: { queueId: true, scheduledAt: true },
    });
    const result = await publishPost(id);
    // A lined-up posting sent early leaves its slot; posting clears scheduledAt, so without
    // this the hourly fill would put a second post in the slot it already used.
    if (result.ok && slot?.queueId && slot.scheduledAt && slot.scheduledAt > new Date()) {
      await skipQueueSlot(slot.queueId, slot.scheduledAt);
    }
    return result.ok
      ? okResponse({ status: result.status, targets: result.targets })
      : errorResponse(result.error, result.status);
  } catch (error) {
    console.error("[admin/social/publish] Error:", error);
    return errorResponse("Something went wrong while posting. Check the post for its status.", 500);
  }
}
