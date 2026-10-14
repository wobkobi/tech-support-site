// src/app/api/admin/social/designs/[id]/route.ts
// One post maker design. PATCH is a sparse update guarded by the updatedAt the editor
// loaded, so a second tab can't silently overwrite newer work: a stale save gets 409.

import { parseObjectId } from "@/features/business/lib/validation";
import { DESIGN_KINDS, toDesignRow, toKind } from "@/features/social-design/lib/design-row";
import { MAX_DOC_BYTES, parseDesignDoc } from "@/features/social-design/lib/doc";
import { snapshotBeforeSave } from "@/features/social-design/lib/versions";
import { errorResponse, isRecordNotFound, noStore, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

const MAX_NAME = 120;

/** Route context. */
interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/admin/social/designs/[id]
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the design id.
 * @returns JSON `{ design }`.
 */
export async function GET(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Design not found.", 404);
  const design = await prisma.socialDesign.findUnique({ where: { id } });
  if (!design) return errorResponse("Design not found.", 404);
  return noStore(okResponse({ design: toDesignRow(design) }));
}

/**
 * PATCH /api/admin/social/designs/[id] - saves the editor's changes.
 * Body: `{ expectedUpdatedAt, name?, kind?, doc? }`. Only fields present are written.
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the design id.
 * @returns JSON `{ updatedAt }`, 409 when the design changed since the editor loaded it.
 */
export async function PATCH(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Design not found.", 404);

  // Size is checked on the raw text before parsing, so an oversized body never builds
  // a huge object.
  const text = await request.text();
  if (text.length > MAX_DOC_BYTES) return errorResponse("This design is too big to save.", 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return errorResponse("The save wasn't valid JSON.", 400);
  }

  const expected =
    typeof body.expectedUpdatedAt === "string" ? new Date(body.expectedUpdatedAt) : null;
  if (!expected || Number.isNaN(expected.getTime())) {
    return errorResponse("expectedUpdatedAt is required.", 400);
  }

  // Sparse update: only fields present in the body get written.
  const data: Prisma.SocialDesignUpdateManyMutationInput = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return errorResponse("The name can't be empty.", 400);
    }
    data.name = body.name.trim().slice(0, MAX_NAME);
  }
  if (body.kind !== undefined) {
    if (typeof body.kind !== "string" || !(DESIGN_KINDS as readonly string[]).includes(body.kind)) {
      return errorResponse("kind isn't a known kind.", 400);
    }
    data.kind = toKind(body.kind);
  }
  if (body.doc !== undefined) {
    const parsed = parseDesignDoc(body.doc);
    if ("error" in parsed) return errorResponse(parsed.error, 400);
    data.doc = parsed.doc as unknown as Prisma.InputJsonValue;
  }

  // Copy the design as it stands before this save, for the History menu. A failure
  // here never blocks the save itself.
  if (data.doc !== undefined) {
    await snapshotBeforeSave(id).catch((error: unknown) =>
      console.error(`[social-design] ${id} version copy failed:`, error),
    );
  }

  // One conditional write: matching on updatedAt makes check-and-save atomic, so two
  // tabs saving at once can't both win. updatedAt is set explicitly so the value
  // returned is exactly the one stored.
  const updatedAt = new Date();
  const result = await prisma.socialDesign.updateMany({
    where: { id, updatedAt: expected },
    data: { ...data, updatedAt },
  });
  if (result.count === 0) {
    const exists = await prisma.socialDesign.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return errorResponse("Design not found.", 404);
    return errorResponse("This design changed in another tab. Reload to see the latest.", 409);
  }
  return okResponse({ updatedAt: updatedAt.toISOString() });
}

/**
 * DELETE /api/admin/social/designs/[id]
 * @param request - Incoming request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the design id.
 * @returns JSON `{}`.
 */
export async function DELETE(request: NextRequest, { params }: Ctx): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const id = parseObjectId((await params).id);
  if (!id) return errorResponse("Design not found.", 404);
  try {
    await prisma.socialDesign.delete({ where: { id } });
    await prisma.socialDesignVersion.deleteMany({ where: { designId: id } });
  } catch (error) {
    if (isRecordNotFound(error)) return errorResponse("Design not found.", 404);
    throw error;
  }
  return okResponse();
}
