// src/app/api/business/rates/[id]/route.ts
/**
 * @description Admin single-rate endpoint. PATCH applies a sparse update,
 * clearing the default flag on other rows when isDefault is set; DELETE removes
 * the rate but blocks deletion of the last remaining one. Both return 404 when
 * the rate does not exist.
 */

import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

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
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;
  const body = await request.json();
  const { label, ratePerHour, flatRate, hourlyDelta, percentDelta, unit, isDefault } = body;

  // Reject non-finite numerics before they reach Prisma (NaN from an empty form
  // field, Infinity from a crafted body) - these values feed the public
  // estimator and the AI calculator, so a bad rate must never persist.
  for (const [key, val] of Object.entries({ ratePerHour, flatRate, hourlyDelta, percentDelta })) {
    if (val !== undefined && val !== null && !Number.isFinite(val)) {
      return errorResponse(`Invalid ${key}`, 400);
    }
  }

  try {
    const rate = await prisma.rateConfig.update({
      where: { id },
      data: {
        ...(label !== undefined && { label }),
        ...(ratePerHour !== undefined && { ratePerHour }),
        ...(flatRate !== undefined && { flatRate }),
        ...(hourlyDelta !== undefined && { hourlyDelta }),
        ...(percentDelta !== undefined && { percentDelta }),
        ...(unit !== undefined && { unit }),
        ...(isDefault !== undefined && { isDefault }),
      },
    });
    // Clear the default flag on the other rows only after the target update
    // succeeds - a stale or deleted id must not wipe every default and then
    // 404, leaving zero default rates for the public estimator to fall through.
    if (isDefault) {
      await prisma.rateConfig.updateMany({
        where: { id: { not: id } },
        data: { isDefault: false },
      });
    }
    return NextResponse.json({ ok: true, rate });
  } catch {
    return errorResponse("Rate not found", 404);
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
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;
  const count = await prisma.rateConfig.count();
  if (count <= 1) {
    return errorResponse("Cannot delete the only rate", 400);
  }

  try {
    await prisma.rateConfig.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return errorResponse("Rate not found", 404);
  }
}
