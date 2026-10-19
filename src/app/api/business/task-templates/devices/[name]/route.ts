// src/app/api/business/task-templates/devices/[name]/route.ts
// Admin endpoint to rename (PATCH) or retire (DELETE) a task-template device tag.
// Clearing is effectively permanent: the tag leaves parse-job's vocabulary and null-device
// rows never match. To fix a misspelt tag ("Pc" vs "PC"), PATCH it instead.

import { renameTaxonomyTag } from "@/features/business/lib/task-taxonomy.server";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * PATCH /api/business/task-templates/devices/[name]
 * Renames a device tag across every template, merging (device, action) collisions.
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
  // Case-only renames are allowed (they fix split spellings).
  if (from === to) return errorResponse("to must differ from the current name", 400);

  const result = await renameTaxonomyTag("device", from, to);
  return NextResponse.json({ ok: true, ...result });
}

/**
 * DELETE /api/business/task-templates/devices/[name]
 * Clears `device` (case-insensitive) on every matching TaskTemplate; the rows go inert.
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
