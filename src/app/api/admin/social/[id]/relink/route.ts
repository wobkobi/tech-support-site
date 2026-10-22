// src/app/api/admin/social/[id]/relink/route.ts
// Makes a posting edited by hand follow its content item again, copying the item over it.

import { parseObjectId } from "@/features/business/lib/validation";
import { relinkPosting } from "@/features/social/lib/postings.server";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/social/[id]/relink
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the posting id.
 * @returns JSON `{ ok }`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Post not found.", 404);
  const result = await relinkPosting(id);
  return result.ok ? okResponse() : errorResponse(result.error, result.status);
}
