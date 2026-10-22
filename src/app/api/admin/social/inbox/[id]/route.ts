// src/app/api/admin/social/inbox/[id]/route.ts
// One inbox message: set its thread's read and archive marks, or delete it on the app (on
// Google, only our reply to a review).

import { parseObjectId } from "@/features/business/lib/validation";
import {
  actionErrorResponse,
  deleteMessage,
  setMarks,
} from "@/features/social/lib/inbox/actions.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/admin/social/inbox/[id]
 * Body: `{ read?: boolean, archived?: boolean }`.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the message id.
 * @returns JSON `{ ok }`.
 */
export async function PATCH(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("That message has been deleted.", 404);
  const body = (await request.json().catch(() => null)) as {
    read?: unknown;
    archived?: unknown;
  } | null;
  const read = typeof body?.read === "boolean" ? body.read : undefined;
  const archived = typeof body?.archived === "boolean" ? body.archived : undefined;
  if (read === undefined && archived === undefined) {
    return errorResponse("Say what to change.", 400);
  }
  try {
    await setMarks(id, { read, archived }, new Date());
    return okResponse({});
  } catch (error) {
    return actionErrorResponse(error, "admin/social/inbox/[id] PATCH");
  }
}

/**
 * DELETE /api/admin/social/inbox/[id]
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the message id.
 * @returns JSON `{ ok }`.
 */
export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("That message has been deleted.", 404);
  try {
    await deleteMessage(id, new Date());
    return okResponse({});
  } catch (error) {
    return actionErrorResponse(error, "admin/social/inbox/[id] DELETE");
  }
}
