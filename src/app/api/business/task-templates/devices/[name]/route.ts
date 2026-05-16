import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

/**
 * DELETE /api/business/task-templates/devices/[name]
 * Removes the device tag from every TaskTemplate currently labelled with `name`
 * (sets `device: null`). Used when the operator wants to retire or split a
 * device label - the tasks themselves stay; only the tag is cleared. Next
 * parse-job run will re-tag them based on the description.
 *
 * `name` is matched case-insensitively to tolerate any leftover casing drift.
 * @param request - Incoming Next.js request.
 * @param root0 - Route context.
 * @param root0.params - Promise resolving to the route param object.
 * @returns JSON `{ ok, cleared: number }` with the count of rows updated.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await params;
  const decoded = decodeURIComponent(name).trim();
  if (!decoded) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const result = await prisma.taskTemplate.updateMany({
    where: { device: { equals: decoded, mode: "insensitive" } },
    data: { device: null },
  });

  return NextResponse.json({ ok: true, cleared: result.count });
}
