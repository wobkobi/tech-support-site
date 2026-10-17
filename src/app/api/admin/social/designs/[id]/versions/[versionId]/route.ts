// src/app/api/admin/social/designs/[id]/versions/[versionId]/route.ts
// One saved copy of a design. The editor restores it as an ordinary edit (undoable,
// then autosaved), so there is no restore route.

import { parseObjectId } from "@/features/business/lib/validation";
import { parseDesignDoc } from "@/features/social-design/lib/doc";
import { errorResponse, noStore, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string; versionId: string }>;
}

/**
 * GET /api/admin/social/designs/[id]/versions/[versionId]
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the design and version ids.
 * @returns JSON `{ name, doc }`.
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const p = await params;
  const id = parseObjectId(p.id);
  const versionId = parseObjectId(p.versionId);
  if (!id || !versionId) return errorResponse("Version not found.", 404);
  const version = await prisma.socialDesignVersion.findFirst({
    where: { id: versionId, designId: id },
  });
  if (!version) return errorResponse("Version not found.", 404);
  const parsed = parseDesignDoc(version.doc);
  if ("error" in parsed) return errorResponse(`That version can't be opened: ${parsed.error}`, 422);
  return noStore(okResponse({ name: version.name, doc: parsed.doc }));
}
