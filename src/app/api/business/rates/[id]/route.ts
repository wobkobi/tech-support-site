import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

/**
 * PATCH /api/business/rates/[id] - Updates a rate configuration, handling isDefault exclusivity.
 * @param request - Incoming Next.js request with updated fields in body
 * @param root0 - Route context
 * @param root0.params - Route params containing the rate ID
 * @returns JSON with the updated rate
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { label, ratePerHour, flatRate, hourlyDelta, unit, isDefault } = body;

  if (isDefault) {
    await prisma.rateConfig.updateMany({ data: { isDefault: false } });
  }

  try {
    const rate = await prisma.rateConfig.update({
      where: { id },
      data: {
        ...(label !== undefined && { label }),
        ...(ratePerHour !== undefined && { ratePerHour }),
        ...(flatRate !== undefined && { flatRate }),
        ...(hourlyDelta !== undefined && { hourlyDelta }),
        ...(unit !== undefined && { unit }),
        ...(isDefault !== undefined && { isDefault }),
      },
    });
    return NextResponse.json({ ok: true, rate });
  } catch {
    return NextResponse.json({ error: "Rate not found" }, { status: 404 });
  }
}

/**
 * DELETE /api/business/rates/[id] - Deletes a rate config, blocking deletion if it is the last one.
 * @param request - Incoming Next.js request
 * @param root0 - Route context
 * @param root0.params - Route params containing the rate ID
 * @returns JSON confirmation or error
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const count = await prisma.rateConfig.count();
  if (count <= 1) {
    return NextResponse.json({ error: "Cannot delete the only rate" }, { status: 400 });
  }

  try {
    await prisma.rateConfig.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Rate not found" }, { status: 404 });
  }
}
