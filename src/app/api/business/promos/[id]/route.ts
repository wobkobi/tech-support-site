// src/app/api/business/promos/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { ACTIVE_PROMO_TAG } from "@/features/business/lib/promos";

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
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  try {
    const promo = await prisma.promo.update({
      where: { id },
      data: {
        ...(body.title !== undefined && { title: body.title }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.startAt !== undefined && { startAt: new Date(body.startAt) }),
        ...(body.endAt !== undefined && { endAt: new Date(body.endAt) }),
        ...(body.flatHourlyRate !== undefined && { flatHourlyRate: body.flatHourlyRate }),
        ...(body.percentDiscount !== undefined && { percentDiscount: body.percentDiscount }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });
    // Next 16's revalidateTag now requires a profile arg.
    revalidateTag(ACTIVE_PROMO_TAG, "default");
    return NextResponse.json({ ok: true, promo });
  } catch {
    return NextResponse.json({ error: "Promo not found" }, { status: 404 });
  }
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
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    await prisma.promo.delete({ where: { id } });
    // Next 16's revalidateTag now requires a profile arg.
    revalidateTag(ACTIVE_PROMO_TAG, "default");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Promo not found" }, { status: 404 });
  }
}
