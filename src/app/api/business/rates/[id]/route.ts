// src/app/api/business/rates/[id]/route.ts
// Admin single-rate endpoint: sparse PATCH (isDefault is exclusive) and DELETE, which
// refuses to remove the last rate.

import { RATE_CONFIG_TAG } from "@/features/business/lib/pricing-policy.server";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { revalidateTag } from "next/cache";
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

  // Reject NaN/Infinity: rates feed the public estimator and AI calculator.
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
    // Clear other defaults only after the update succeeds, so a stale id can't
    // leave zero default rates.
    if (isDefault) {
      await prisma.rateConfig.updateMany({
        where: { id: { not: id } },
        data: { isDefault: false },
      });
    }
    // Next 16's revalidateTag requires a second CacheLifeConfig arg.
    revalidateTag(RATE_CONFIG_TAG, {});
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
    // Next 16's revalidateTag requires a second CacheLifeConfig arg.
    revalidateTag(RATE_CONFIG_TAG, {});
    return NextResponse.json({ ok: true });
  } catch {
    return errorResponse("Rate not found", 404);
  }
}
