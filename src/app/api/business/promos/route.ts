// src/app/api/business/promos/route.ts
// Admin promo collection endpoint: GET lists promos, POST validates and creates one and
// revalidates the active-promo cache tag.

import { getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import { snapshotDeltas } from "@/features/business/lib/promo-locked-rates";
import {
  resolveDiscountType,
  validateDiscount,
  validateKind,
  validateLimits,
  validateRecurringWindow,
  validateTiers,
  type DiscountCheckOptions,
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

interface PromoBody {
  title?: string;
  description?: string | null;
  startAt?: string;
  endAt?: string;
  flatHourlyRate?: number | null;
  percentDiscount?: number | null;
  isActive?: boolean;
  priority?: number;
  discountType?: "flat_hourly" | "percent" | "fixed_amount" | "free_travel";
  fixedAmount?: number | null;
  travelPercent?: number | null;
  kind?: PromoKind;
  code?: string | null;
  maxRedemptions?: number | null;
  perCustomerLimit?: number | null;
  newCustomersOnly?: boolean;
  activeWeekdays?: number[];
  activeFromMinute?: number | null;
  activeToMinute?: number | null;
  minSpend?: number | null;
  tiers?: PromoTierInput[];
}

/**
 * Validates a {@link PromoBody}. Enforces the per-type discount fields, the
 * kind/code pairing, and start < end.
 * @param body - Parsed request body.
 * @param rates - The live Standard rate a flat promo must come in under.
 * @returns Error message or null when valid.
 */
function validatePromo(body: PromoBody, rates: DiscountCheckOptions): string | null {
  if (!body.title || typeof body.title !== "string") return "title is required";
  if (!body.startAt || !body.endAt) return "startAt and endAt are required";
  // Parse first: an Invalid Date passes `start >= end` and 500s the Prisma create.
  const startAt = parseDate(body.startAt);
  const endAt = parseDate(body.endAt);
  if (!startAt || !endAt) return "startAt and endAt must be valid dates";
  if (startAt >= endAt) {
    return "startAt must be before endAt";
  }
  // Shared with the edit route so the two can't drift.
  const discountError = validateDiscount(body, rates);
  if (discountError) return discountError;
  const kindError = validateKind({ kind: body.kind, code: normalisePromoCode(body.code) });
  if (kindError) return kindError;
  const limitError = validateLimits(body);
  if (limitError) return limitError;
  const windowError = validateRecurringWindow(body);
  if (windowError) return windowError;
  const tierError = validateTiers(resolveDiscountType(body), body.minSpend, body.tiers, rates);
  if (tierError) return tierError;
  // A fractional priority would order unpredictably against the integer column.
  if (body.priority !== undefined && !Number.isInteger(body.priority)) {
    return "priority must be a whole number";
  }
  return null;
}

/**
 * GET /api/business/promos - Lists all promos newest start first.
 * @param request - Incoming request.
 * @returns JSON with promos array.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }
  const promos = await prisma.promo.findMany({ orderBy: { startAt: "desc" } });
  return NextResponse.json({ ok: true, promos });
}

/**
 * POST /api/business/promos - Creates a promo and invalidates the cache.
 * @param request - Incoming request with PromoBody.
 * @returns JSON with the created promo.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }
  const body = (await request.json()) as PromoBody;
  const { baseRate } = await getPublicPricing();
  const err = validatePromo(body, { standardRate: baseRate });
  if (err) return errorResponse(err, 400);

  // Stored uppercase so a customer's lowercase typing still matches.
  const code = normalisePromoCode(body.code);
  if (await isPromoCodeTaken(code)) {
    return errorResponse("that code is already used by another promo", 409);
  }

  // Saved for every type so a promo switched to flat later still keeps today's gaps.
  const rates = await prisma.rateConfig.findMany({
    select: { label: true, unit: true, hourlyDelta: true },
  });
  const promo = await prisma.promo.create({
    data: {
      lockedDeltas: snapshotDeltas(rates),
      title: body.title!,
      description: body.description ?? null,
      startAt: parseDate(body.startAt)!,
      endAt: parseDate(body.endAt)!,
      discountType: resolveDiscountType(body),
      flatHourlyRate: body.flatHourlyRate ?? null,
      percentDiscount: body.percentDiscount ?? null,
      fixedAmount: body.fixedAmount ?? null,
      travelPercent: body.travelPercent ?? null,
      kind: body.kind ?? "automatic",
      code,
      maxRedemptions: body.maxRedemptions ?? null,
      perCustomerLimit: body.perCustomerLimit ?? null,
      newCustomersOnly: body.newCustomersOnly ?? false,
      activeWeekdays: body.activeWeekdays ?? [],
      activeFromMinute: body.activeFromMinute ?? null,
      activeToMinute: body.activeToMinute ?? null,
      minSpend: body.minSpend ?? null,
      // Stored unsorted; resolution reduces, and duplicate floors are already rejected.
      tiers: (body.tiers ?? []).map((t) => ({
        minSpend: t.minSpend!,
        flatHourlyRate: t.flatHourlyRate ?? null,
        percentDiscount: t.percentDiscount ?? null,
        fixedAmount: t.fixedAmount ?? null,
        travelPercent: t.travelPercent ?? null,
      })),
      isActive: body.isActive ?? true,
      priority: body.priority ?? 0,
    },
  });

  // Next 16's revalidateTag requires a second CacheLifeConfig arg.
  revalidateTag(ACTIVE_PROMO_TAG, {});
  return NextResponse.json({ ok: true, promo }, { status: 201 });
}
