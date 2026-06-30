// src/app/api/business/task-templates/devices/[name]/route.ts
/**
 * @description Admin endpoint to retire a task-template device tag. DELETE
 * clears the device (sets it to null, case-insensitive match) on every matching
 * TaskTemplate, leaving the rows intact for the next parse-job to retag, and
 * returns the count of rows updated.
 */

import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * DELETE /api/business/task-templates/devices/[name]
 * Clears `device` (case-insensitive match) on every matching TaskTemplate.
 * Tasks stay; tag is cleared. Next parse-job run re-tags from description.
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
