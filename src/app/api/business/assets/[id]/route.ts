// src/app/api/business/assets/[id]/route.ts
// Admin single-asset endpoint. PUT is a full replace: the whole body is validated with
// parseAssetBody and every column is written, so a cleared field clears. DELETE removes
// the asset; a linked expense then counts as an ordinary expense again.

import { expenseLinkProblem } from "@/features/business/lib/asset-links.server";
import { parseAssetBody } from "@/features/business/lib/assets";
import { parseObjectId } from "@/features/business/lib/validation";
import { errorResponse, isRecordNotFound, noStore } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * PUT /api/business/assets/[id] - Replaces an asset's fields.
 * @param request - Incoming Next.js request with the full asset in the body.
 * @param root0 - Route context.
 * @param root0.params - Route params promise holding the asset id.
 * @returns JSON `{ ok: true, asset }`, or `{ ok: false, error }`.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return noStore(errorResponse("Unauthorized", 401));

  // A malformed id would make Prisma throw (500); it can't name an asset, so 404.
  const id = parseObjectId((await params).id);
  if (!id) return noStore(errorResponse("Asset not found", 404));

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore(errorResponse("Invalid JSON body", 400));
  }
  const parsed = parseAssetBody(body);
  if (!parsed.ok) return noStore(errorResponse(parsed.error, 400));

  const existing = await prisma.asset.findUnique({ where: { id }, select: { expenseId: true } });
  if (!existing) return noStore(errorResponse("Asset not found", 404));

  // Only a new or changed link is checked, so an asset whose expense row has since been
  // deleted still saves its other edits.
  if (parsed.data.expenseId && parsed.data.expenseId !== existing.expenseId) {
    const problem = await expenseLinkProblem(parsed.data.expenseId, id);
    if (problem) return noStore(errorResponse(problem.error, problem.status));
  }

  const asset = await prisma.asset.update({ where: { id }, data: parsed.data });
  return noStore(NextResponse.json({ ok: true, asset }));
}

/**
 * DELETE /api/business/assets/[id] - Deletes an asset.
 * @param request - Incoming Next.js request.
 * @param root0 - Route context.
 * @param root0.params - Route params promise holding the asset id.
 * @returns JSON `{ ok: true }`, or 404 when there is no such asset.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return noStore(errorResponse("Unauthorized", 401));

  const id = parseObjectId((await params).id);
  if (!id) return noStore(errorResponse("Asset not found", 404));
  try {
    await prisma.asset.delete({ where: { id } });
    return noStore(NextResponse.json({ ok: true }));
  } catch (err) {
    // A missing or stale id (P2025) is a 404; anything else, such as a DB outage, is a 500.
    if (isRecordNotFound(err)) return noStore(errorResponse("Asset not found", 404));
    throw err;
  }
}
