// src/app/api/admin/social/inbox/[id]/hide/route.ts
// Hides a Facebook or Instagram comment on the app, or shows it again. A hidden comment stays
// visible to its writer and their friends only.

import { parseObjectId } from "@/features/business/lib/validation";
import { actionErrorResponse, setHidden } from "@/features/social/lib/inbox/actions.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/social/inbox/[id]/hide
 * Body: `{ hidden: boolean }`.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the message id.
 * @returns JSON `{ ok }`.
 */
export async function POST(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("That message has been deleted.", 404);
  const body = (await request.json().catch(() => null)) as { hidden?: unknown } | null;
  if (typeof body?.hidden !== "boolean") return errorResponse("Say whether to hide it.", 400);
  try {
    await setHidden(id, body.hidden, new Date());
    return okResponse({});
  } catch (error) {
    return actionErrorResponse(error, "admin/social/inbox/[id]/hide");
  }
}
