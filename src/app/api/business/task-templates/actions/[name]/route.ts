import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

/**
 * DELETE /api/business/task-templates/actions/[name]
 * Removes the action tag from every TaskTemplate currently labelled with
 * `name` (sets `action: null`). Mirrors the devices endpoint - clears the
 * tag, leaves the row intact, lets the next parse-job retag.
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
    where: { action: { equals: decoded, mode: "insensitive" } },
    data: { action: null },
  });

  return NextResponse.json({ ok: true, cleared: result.count });
}
