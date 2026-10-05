// src/app/api/admin/social/[id]/take-down/route.ts
// Deletes a posted post from every platform it's up on. The post itself stays in the
// list, marked taken down, so it can still be duplicated.

import { parseObjectId } from "@/features/business/lib/validation";
import { takeDownPost } from "@/features/social/lib/publish";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/social/[id]/take-down
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the post id.
 * @returns JSON `{ status, targets }`; a platform that refused stays posted with its error.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Post not found.", 404);

  try {
    const result = await takeDownPost(id);
    return result.ok
      ? okResponse({ status: result.status, targets: result.targets })
      : errorResponse(result.error, result.status);
  } catch (error) {
    console.error("[admin/social/take-down] Error:", error);
    return errorResponse(
      "Something went wrong while taking it down. Check the post for its status.",
      500,
    );
  }
}
