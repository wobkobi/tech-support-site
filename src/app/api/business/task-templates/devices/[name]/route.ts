// src/app/api/business/task-templates/devices/[name]/route.ts
/**
 * @description Admin endpoint to retire a task-template device tag. DELETE
 * clears the device (sets it to null, case-insensitive match) on every matching
 * TaskTemplate and returns the count of rows updated.
 *
 * Clearing a device is effectively PERMANENT - nothing re-tags the rows later.
 * parse-job may only reuse device tags from the live vocabulary, and that
 * vocabulary is built from this very field, so a retired tag is never offered to
 * the model again; `findTemplateByTags` also needs BOTH device and action, so a
 * null-device row can never match. The rows survive but go inert, and the work
 * they described gets tagged as something else (or an invented tag) from then on.
 *
 * Retire a tag only when that work is genuinely gone. To fix a drifted or
 * misspelt tag ("Desktop / Pc" vs "Desktop / PC"), re-tag the rows to the
 * canonical spelling - do NOT clear it and expect it to come back.
 */

import { renameTaxonomyTag } from "@/features/business/lib/task-taxonomy";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * PATCH /api/business/task-templates/devices/[name]
 * Renames a device tag across every template using it, merging any row that
 * collides with an existing (device, action) pair. Use this - not DELETE - to
 * fix a drifted or misspelt tag, because a rename is recoverable and a clear
 * is not.
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
  if (from.toLowerCase() === to.toLowerCase() && from === to) {
    return errorResponse("to must differ from the current name", 400);
  }

  const result = await renameTaxonomyTag("device", from, to);
  return NextResponse.json({ ok: true, ...result });
}

/**
 * DELETE /api/business/task-templates/devices/[name]
 * Clears `device` (case-insensitive match) on every matching TaskTemplate. The
 * rows survive but go inert - nothing re-tags them automatically (see the file
 * header); re-tag by hand if the work still exists.
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
    where: { device: { equals: decoded, mode: "insensitive" } },
    data: { device: null },
  });

  return NextResponse.json({ ok: true, cleared: result.count });
}
