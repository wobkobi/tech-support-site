// src/app/api/admin/social/inbox/[id]/reply/route.ts
// Sends a reply on the app to a comment or review. A Google review holds one reply, which this
// replaces.

import { parseObjectId } from "@/features/business/lib/validation";
import { actionErrorResponse, replyTo } from "@/features/social/lib/inbox/actions.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/social/inbox/[id]/reply
 * Body: `{ text: string }`.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the message id.
 * @returns JSON `{ id }`, our id for the reply.
 */
export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("That message has been deleted.", 404);
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text : "";
  try {
    const replyId = await replyTo(id, text, new Date());
    return okResponse({ id: replyId });
  } catch (error) {
    return actionErrorResponse(error, "admin/social/inbox/[id]/reply");
  }
}
