// src/app/api/business/promos/route.ts
/**
 * @description Admin promo collection endpoint. GET lists every promo newest
 * start first; POST validates a {@link PromoBody} via {@link validatePromo}
 * (XOR of flatHourlyRate/percentDiscount, startAt before endAt), creates the
 * promo, and revalidates the active-promo cache tag.
 */

import { ACTIVE_PROMO_TAG } from "@/features/business/lib/promos";
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
}

/**
 * Validates a {@link PromoBody}. Enforces XOR of pricing fields + start < end.
 * @param body - Parsed request body.
 * @returns Error message or null when valid.
 */
function validatePromo(body: PromoBody): string | null {
  if (!body.title || typeof body.title !== "string") return "title is required";
  if (!body.startAt || !body.endAt) return "startAt and endAt are required";
  // Parse before comparing: an unparseable date compares false against
  // everything, so `start >= end` would pass it through to Prisma, which
  // rejects an Invalid Date and 500s the create.
  const startAt = parseDate(body.startAt);
  const endAt = parseDate(body.endAt);
  if (!startAt || !endAt) return "startAt and endAt must be valid dates";
  if (startAt >= endAt) {
    return "startAt must be before endAt";
  }
  const hasFlat = typeof body.flatHourlyRate === "number" && body.flatHourlyRate > 0;
  const hasPct = typeof body.percentDiscount === "number" && body.percentDiscount > 0;
  if (hasFlat === hasPct) {
    return "exactly one of flatHourlyRate or percentDiscount must be set";
  }
  if (hasPct && (body.percentDiscount! <= 0 || body.percentDiscount! >= 1)) {
    return "percentDiscount must be between 0 and 1 (e.g. 0.20 for 20%)";
  }
  // Reject rather than coerce: a fractional priority would order unpredictably
  // against the integer column and read as accepted.
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
  const err = validatePromo(body);
  if (err) return errorResponse(err, 400);

  const promo = await prisma.promo.create({
    data: {
      title: body.title!,
      description: body.description ?? null,
      startAt: parseDate(body.startAt)!,
      endAt: parseDate(body.endAt)!,
      flatHourlyRate: body.flatHourlyRate ?? null,
      percentDiscount: body.percentDiscount ?? null,
      isActive: body.isActive ?? true,
      priority: body.priority ?? 0,
    },
  });

  // Next 16's revalidateTag requires a second CacheLifeConfig arg.
  revalidateTag(ACTIVE_PROMO_TAG, {});
  return NextResponse.json({ ok: true, promo }, { status: 201 });
}
