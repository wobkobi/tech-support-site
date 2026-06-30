// src/app/api/business/task-templates/[id]/route.ts
/**
 * @description Admin single task-template endpoint. DELETE removes a saved task
 * template by ID and returns 404 when it does not exist.
 */

import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * DELETE /api/business/task-templates/[id] - Deletes a saved task template.
 * @param request - Incoming Next.js request
 * @param root0 - Route context
 * @param root0.params - Route params containing the template ID
 * @returns JSON confirmation or error
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;

  try {
    await prisma.taskTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return errorResponse("Template not found", 404);
  }
}
