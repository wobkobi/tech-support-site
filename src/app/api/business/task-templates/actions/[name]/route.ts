// src/app/api/business/task-templates/actions/[name]/route.ts
/**
 * @description Admin endpoint to rename or retire a task-template action tag.
 * PATCH renames it across every row (merging collisions) and is the safe way to
 * fix a drifted or misspelt tag. DELETE clears the action (sets it to null,
 * case-insensitive match) on every matching TaskTemplate.
 *
 * Clearing an action is effectively PERMANENT - nothing re-tags the rows later.
 * parse-job may only reuse tags from the live vocabulary, and that vocabulary is
 * built from this very field, so a retired tag is never offered to the model
 * again; `findTemplateByTags` also needs BOTH device and action, so a
 * null-action row can never match. The rows survive but go inert. Retire a tag
 * only when that work is genuinely gone - otherwise PATCH it to the canonical
 * spelling.
 */

import { renameTaxonomyTag } from "@/features/business/lib/task-taxonomy";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * PATCH /api/business/task-templates/actions/[name]
 * Renames an action tag across every template using it, merging any row that
 * collides with an existing (device, action) pair.
 * @param request - Incoming Next.js request with `{ to: string }` body.
 * @param root0 - Route context.
 * @param root0.params - Promise resolving to the route param object.
 * @returns JSON `{ ok, renamed: number, merged: number }`.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { name } = await params;
  const from = decodeURIComponent(name).trim();
  const body = (await request.json().catch(() => null)) as { to?: unknown } | null;
  const to = typeof body?.to === "string" ? body.to.trim() : "";

  if (!from) return errorResponse("name is required", 400);
  if (!to) return errorResponse("to is required", 400);
  if (from === to) return errorResponse("to must differ from the current name", 400);

  const result = await renameTaxonomyTag("action", from, to);
  return NextResponse.json({ ok: true, ...result });
}

/**
 * DELETE /api/business/task-templates/actions/[name]
 * Removes the action tag from every TaskTemplate currently labelled with
 * `name` (sets `action: null`). The rows survive but go inert - nothing re-tags
 * them automatically (see the file header); PATCH instead to fix a spelling.
 * @param request - Incoming Next.js request.
 * @param root0 - Route context.
 * @param root0.params - Promise resolving to the route param object.
 * @returns JSON `{ ok, cleared: number }` with the count of rows updated.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { name } = await params;
  const decoded = decodeURIComponent(name).trim();
  if (!decoded) {
    return errorResponse("name is required", 400);
  }

  const result = await prisma.taskTemplate.updateMany({
    where: { action: { equals: decoded, mode: "insensitive" } },
    data: { action: null },
  });

  return NextResponse.json({ ok: true, cleared: result.count });
}
