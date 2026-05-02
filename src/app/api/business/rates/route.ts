import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

const DEFAULTS = [
  { label: "Standard", ratePerHour: 65, flatRate: null, unit: "hour", isDefault: true },
  { label: "Complex work", ratePerHour: 85, flatRate: null, unit: "hour", isDefault: false },
];

/**
 * GET /api/business/rates - Returns all rate configs, seeding six defaults on first call.
 * @param request - Incoming Next.js request
 * @returns JSON with rates array
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const count = await prisma.rateConfig.count();
  if (count === 0) {
    await prisma.rateConfig.createMany({ data: DEFAULTS });
  }

  const rates = await prisma.rateConfig.findMany({ orderBy: { label: "asc" } });
  return NextResponse.json({ ok: true, rates });
}

/**
 * POST /api/business/rates - Creates a new rate configuration.
 * @param request - Incoming Next.js request with rate data in body
 * @returns JSON with the created rate
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { label, ratePerHour, flatRate, unit, isDefault } = body;

  if (!label || typeof label !== "string") {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }

  if (isDefault) {
    await prisma.rateConfig.updateMany({ data: { isDefault: false } });
  }

  const rate = await prisma.rateConfig.create({
    data: {
      label,
      ratePerHour: ratePerHour ?? null,
      flatRate: flatRate ?? null,
      unit: unit ?? "hour",
      isDefault: isDefault ?? false,
    },
  });

  return NextResponse.json({ ok: true, rate }, { status: 201 });
}
