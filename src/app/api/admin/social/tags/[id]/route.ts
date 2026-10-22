// src/app/api/admin/social/tags/[id]/route.ts
// One post tag: rename or recolour it, or delete it and take it off every post.

import { parseObjectId } from "@/features/business/lib/validation";
import { changeTag, deleteTag } from "@/features/social/lib/tags.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/admin/social/tags/[id]
 * Body: `{ name?, colour? }`.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the tag id.
 * @returns JSON `{ tag }`, 409 when another tag has the name.
 */
export async function PATCH(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Tag not found.", 404);
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    colour?: unknown;
  } | null;
  try {
    const result = await changeTag(id, { name: body?.name, colour: body?.colour });
    if (!result.ok) return errorResponse(result.error, result.status);
    return okResponse({ tag: result.tag });
  } catch (error) {
    console.error("[admin/social/tags] Change failed:", error);
    return errorResponse("Couldn't change the tag.", 500);
  }
}

/**
 * DELETE /api/admin/social/tags/[id] - deletes the tag; the posts it was on stay.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the tag id.
 * @returns JSON `{ ok }`.
 */
export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Tag not found.", 404);
  try {
    if (!(await deleteTag(id))) return errorResponse("Tag not found.", 404);
    return okResponse();
  } catch (error) {
    console.error("[admin/social/tags] Delete failed:", error);
    return errorResponse("Couldn't delete the tag.", 500);
  }
}
