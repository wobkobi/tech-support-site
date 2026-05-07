import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

const DEFAULTS = [
  {
    label: "Standard",
    ratePerHour: 65,
    flatRate: null,
    unit: "hour",
    isDefault: true,
  },
  {
    label: "Complex work",
    ratePerHour: 85,
    flatRate: null,
    unit: "hour",
    isDefault: false,
  },
  {
    label: "Remote support",
    ratePerHour: 60,
    flatRate: null,
    unit: "hour",
    isDefault: false,
  },
  {
    label: "At home",
    ratePerHour: 55,
    flatRate: null,
    unit: "hour",
    isDefault: false,
  },
  {
    label: "Complex at home",
    ratePerHour: 75,
    flatRate: null,
    unit: "hour",
    isDefault: false,
  },
  {
    label: "Travel",
    ratePerHour: null,
    flatRate: 1.2,
    unit: "km",
    isDefault: false,
  },
];

/**
 * GET /api/business/rates - Returns all rate configs, seeding any missing defaults on each call.
 * @param request - Incoming Next.js request
 * @returns JSON with rates array
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await prisma.rateConfig.findMany({ select: { label: true } });
  const existingLabels = new Set(existing.map((r) => r.label));
  const missing = DEFAULTS.filter((d) => !existingLabels.has(d.label));
  if (missing.length > 0) {
    await prisma.rateConfig.createMany({ data: missing });
  }
  await prisma.rateConfig.updateMany({
    where: { label: "Travel", flatRate: null },
    data: { flatRate: 1.2 },
  });

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
