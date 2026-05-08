import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

/**
 * DELETE /api/business/expenses/[id] - Deletes an expense entry by ID.
 * @param request - Incoming Next.js request
 * @param root0 - Route context
 * @param root0.params - Route params containing the expense entry ID
 * @returns JSON confirmation
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await prisma.expenseEntry.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
