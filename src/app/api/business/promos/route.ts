// src/app/api/business/promos/route.ts
import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { ACTIVE_PROMO_TAG } from "@/features/business/lib/promos";

interface PromoBody {
  title?: string;
  description?: string | null;
  startAt?: string;
  endAt?: string;
  flatHourlyRate?: number | null;
  percentDiscount?: number | null;
  isActive?: boolean;
}

/**
 * Validates a PromoBody. Enforces XOR of pricing fields + start < end.
 * @param body - Parsed request body.
 * @returns Error message or null when valid.
 */
function validatePromo(body: PromoBody): string | null {
  if (!body.title || typeof body.title !== "string") return "title is required";
  if (!body.startAt || !body.endAt) return "startAt and endAt are required";
  if (new Date(body.startAt) >= new Date(body.endAt)) {
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
  return null;
}

/**
 * GET /api/business/promos - Lists all promos newest start first.
 * @param request - Incoming request.
 * @returns JSON with promos array.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as PromoBody;
  const err = validatePromo(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const promo = await prisma.promo.create({
    data: {
      title: body.title!,
      description: body.description ?? null,
      startAt: new Date(body.startAt!),
      endAt: new Date(body.endAt!),
      flatHourlyRate: body.flatHourlyRate ?? null,
      percentDiscount: body.percentDiscount ?? null,
      isActive: body.isActive ?? true,
    },
  });

  // Next 16's revalidateTag now requires a profile arg.
  revalidateTag(ACTIVE_PROMO_TAG, "default");
  return NextResponse.json({ ok: true, promo }, { status: 201 });
}
