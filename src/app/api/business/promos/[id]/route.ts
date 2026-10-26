// src/app/api/business/promos/[id]/route.ts
// Admin single-promo endpoint: sparse PATCH and DELETE (invoice snapshots stay). Both
// revalidate the active-promo cache tag.

import { getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import {
  resolveDiscountType,
  validateDiscount,
  validateKind,
  validateLimits,
  validateRecurringWindow,
  validateTiers,
  type PromoKind,
  type PromoTierInput,
} from "@/features/business/lib/promo-validation";
import {
  ACTIVE_PROMO_TAG,
  isPromoCodeTaken,
  normalisePromoCode,
} from "@/features/business/lib/promos";
import { parseDate } from "@/features/business/lib/validation";
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
    priority: number;
    discountType: "flat_hourly" | "percent" | "fixed_amount" | "free_travel";
    fixedAmount: number | null;
    travelPercent: number | null;
    kind: PromoKind;
    code: string | null;
    maxRedemptions: number | null;
    perCustomerLimit: number | null;
    newCustomersOnly: boolean;
    activeWeekdays: number[];
    activeFromMinute: number | null;
    activeToMinute: number | null;
    minSpend: number | null;
    tiers: PromoTierInput[];
  }>;

  if (body.priority !== undefined && !Number.isInteger(body.priority)) {
    return errorResponse("priority must be a whole number", 400);
  }

  const existing = await prisma.promo.findUnique({ where: { id } });
  if (!existing) {
    return errorResponse("Promo not found", 404);
  }

  // Validate the MERGED row so a sparse PATCH can't land a promo POST would reject.
  // A cleared date input sends "", so parse rather than test for undefined.
  const startAt = body.startAt !== undefined ? parseDate(body.startAt) : existing.startAt;
  const endAt = body.endAt !== undefined ? parseDate(body.endAt) : existing.endAt;
  if (!startAt || !endAt) {
    return errorResponse("startAt and endAt must be valid dates", 400);
  }
  if (startAt >= endAt) {
    return errorResponse("startAt must be before endAt", 400);
  }

  // Switching type sends the new value column and nulls the old, so judge the merge.
  const merged = {
    discountType: body.discountType ?? existing.discountType,
    flatHourlyRate:
      body.flatHourlyRate !== undefined ? body.flatHourlyRate : existing.flatHourlyRate,
    percentDiscount:
      body.percentDiscount !== undefined ? body.percentDiscount : existing.percentDiscount,
    fixedAmount: body.fixedAmount !== undefined ? body.fixedAmount : existing.fixedAmount,
    travelPercent: body.travelPercent !== undefined ? body.travelPercent : existing.travelPercent,
  };
  // Judged against the live Standard rate only when the discount itself is edited, so
  // switching a promo on or off still works after a rate change.
  const touchesDiscount =
    body.discountType !== undefined ||
    body.flatHourlyRate !== undefined ||
    body.tiers !== undefined;
  const rates = touchesDiscount ? { standardRate: (await getPublicPricing()).baseRate } : {};
  const discountError = validateDiscount(merged, rates);
  if (discountError) {
    return errorResponse(discountError, 400);
  }

  // Switching to automatic sends kind without a code; drop the leftover code.
  const kind = body.kind ?? existing.kind;
  const code =
    kind === "automatic"
      ? null
      : body.code !== undefined
        ? normalisePromoCode(body.code)
        : existing.code;
  const kindError = validateKind({ kind, code });
  if (kindError) {
    return errorResponse(kindError, 400);
  }
  // Exclude this promo so an unchanged code doesn't conflict with itself.
  if (await isPromoCodeTaken(code, id)) {
    return errorResponse("that code is already used by another promo", 409);
  }

  // Merged: moving one end of a range is judged against the stored other end.
  const limitError = validateLimits({
    maxRedemptions:
      body.maxRedemptions !== undefined ? body.maxRedemptions : existing.maxRedemptions,
    perCustomerLimit:
      body.perCustomerLimit !== undefined ? body.perCustomerLimit : existing.perCustomerLimit,
  });
  if (limitError) {
    return errorResponse(limitError, 400);
  }
  const windowError = validateRecurringWindow({
    activeWeekdays:
      body.activeWeekdays !== undefined ? body.activeWeekdays : existing.activeWeekdays,
    activeFromMinute:
      body.activeFromMinute !== undefined ? body.activeFromMinute : existing.activeFromMinute,
    activeToMinute:
      body.activeToMinute !== undefined ? body.activeToMinute : existing.activeToMinute,
  });
  if (windowError) {
    return errorResponse(windowError, 400);
  }
  // Bands must match the merged discount type.
  const tierError = validateTiers(
    resolveDiscountType(merged),
    body.minSpend !== undefined ? body.minSpend : existing.minSpend,
    body.tiers !== undefined ? body.tiers : existing.tiers,
    rates,
  );
  if (tierError) {
    return errorResponse(tierError, 400);
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
      ...(body.priority !== undefined && { priority: body.priority }),
      ...(body.discountType !== undefined && { discountType: body.discountType }),
      ...(body.fixedAmount !== undefined && { fixedAmount: body.fixedAmount }),
      ...(body.travelPercent !== undefined && { travelPercent: body.travelPercent }),
      ...(body.kind !== undefined && { kind }),
      // Written when kind moves too, so an automatic promo drops its old code.
      ...((body.code !== undefined || body.kind !== undefined) && { code }),
      ...(body.maxRedemptions !== undefined && { maxRedemptions: body.maxRedemptions }),
      ...(body.perCustomerLimit !== undefined && { perCustomerLimit: body.perCustomerLimit }),
      ...(body.newCustomersOnly !== undefined && { newCustomersOnly: body.newCustomersOnly }),
      ...(body.activeWeekdays !== undefined && { activeWeekdays: body.activeWeekdays }),
      ...(body.activeFromMinute !== undefined && { activeFromMinute: body.activeFromMinute }),
      ...(body.activeToMinute !== undefined && { activeToMinute: body.activeToMinute }),
      ...(body.minSpend !== undefined && { minSpend: body.minSpend }),
      ...(body.tiers !== undefined && {
        tiers: body.tiers.map((t) => ({
          minSpend: t.minSpend!,
          flatHourlyRate: t.flatHourlyRate ?? null,
          percentDiscount: t.percentDiscount ?? null,
          fixedAmount: t.fixedAmount ?? null,
          travelPercent: t.travelPercent ?? null,
        })),
      }),
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
