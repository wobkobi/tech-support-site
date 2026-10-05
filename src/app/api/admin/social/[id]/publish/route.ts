// src/app/api/admin/social/[id]/publish/route.ts
// Publishes a post to its platforms now, or re-posts only to the platforms that failed.
// Quiet hours don't apply: a post wakes nobody.

import { parseObjectId } from "@/features/business/lib/validation";
import { publishPost, retryFailed } from "@/features/social/lib/publish";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
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
    const result = body.mode === "retry" ? await retryFailed(id) : await publishPost(id);
    return result.ok
      ? okResponse({ status: result.status, targets: result.targets })
      : errorResponse(result.error, result.status);
  } catch (error) {
    console.error("[admin/social/publish] Error:", error);
    return errorResponse("Something went wrong while posting. Check the post for its status.", 500);
  }
}
