// src/app/api/business/promos/[id]/route.ts
/**
 * @description Admin single-promo endpoint. PATCH applies a sparse update (only
 * fields present in the body are written); DELETE removes the promo while
 * invoice snapshots stay intact. Both revalidate the active-promo cache tag and
 * return 404 when the promo does not exist.
 */

import { ACTIVE_PROMO_TAG } from "@/features/business/lib/promos";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

/**
 * PATCH /api/business/promos/[id] - Partial update; invalidates the cache.
 * @param request - Incoming request with partial PromoBody.
 * @param root0 - Route context.
 * @param root0.params - Route params containing the promo ID.
 * @returns JSON with the updated promo.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }
  const { id } = await params;
  const body = (await request.json()) as Partial<{
    title: string;
    description: string | null;
    startAt: string;
    endAt: string;
    flatHourlyRate: number | null;
    percentDiscount: number | null;
    isActive: boolean;
  }>;

  const existing = await prisma.promo.findUnique({ where: { id } });
  if (!existing) {
    return errorResponse("Promo not found", 404);
  }

  // Merge the patched fields over the current row and re-validate before writing,
  // mirroring POST's validatePromo. A sparse PATCH could otherwise leave the promo
  // in a state POST would reject - both discount fields set, percentDiscount out of
  // range, or endAt before startAt - which then flows straight into public pricing
  // ("500% off", $0/hr).
  const startAt = body.startAt !== undefined ? new Date(body.startAt) : existing.startAt;
  const endAt = body.endAt !== undefined ? new Date(body.endAt) : existing.endAt;
  const flatHourlyRate =
    body.flatHourlyRate !== undefined ? body.flatHourlyRate : existing.flatHourlyRate;
  const percentDiscount =
    body.percentDiscount !== undefined ? body.percentDiscount : existing.percentDiscount;

  if (startAt >= endAt) {
    return errorResponse("startAt must be before endAt", 400);
  }
  const hasFlat = typeof flatHourlyRate === "number" && flatHourlyRate > 0;
  const hasPct = typeof percentDiscount === "number" && percentDiscount > 0;
  if (hasFlat === hasPct) {
    return errorResponse("exactly one of flatHourlyRate or percentDiscount must be set", 400);
  }
  if (hasPct && (percentDiscount! <= 0 || percentDiscount! >= 1)) {
    return errorResponse("percentDiscount must be between 0 and 1 (e.g. 0.20 for 20%)", 400);
  }

  const promo = await prisma.promo.update({
    where: { id },
    data: {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.startAt !== undefined && { startAt }),
      ...(body.endAt !== undefined && { endAt }),
      ...(body.flatHourlyRate !== undefined && { flatHourlyRate: body.flatHourlyRate }),
      ...(body.percentDiscount !== undefined && { percentDiscount: body.percentDiscount }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    },
  });
  // Next 16's revalidateTag requires a second CacheLifeConfig arg.
  revalidateTag(ACTIVE_PROMO_TAG, {});
  return NextResponse.json({ ok: true, promo });
}

/**
 * DELETE /api/business/promos/[id] - Removes a promo (invoice snapshots stay).
 * @param request - Incoming request.
 * @param root0 - Route context.
 * @param root0.params - Route params containing the promo ID.
 * @returns JSON confirmation or 404.
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
    await prisma.promo.delete({ where: { id } });
    // Next 16's revalidateTag requires a second CacheLifeConfig arg.
    revalidateTag(ACTIVE_PROMO_TAG, {});
    return NextResponse.json({ ok: true });
  } catch {
    return errorResponse("Promo not found", 404);
  }
}
