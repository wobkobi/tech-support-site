// src/app/api/admin/social/designs/[id]/versions/route.ts
// A design's saved copies for the editor's History menu, newest first, without their
// documents.

import { parseObjectId } from "@/features/business/lib/validation";
import { errorResponse, noStore, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/social/designs/[id]/versions
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the design id.
 * @returns JSON `{ versions: [{ id, name, createdAt }] }`.
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Design not found.", 404);
  const versions = await prisma.socialDesignVersion.findMany({
    where: { designId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true },
  });
  return noStore(
    okResponse({
      versions: versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() })),
    }),
  );
}
