import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

// Seed shape: one base hourly rate (Standard), a handful of modifier rates that
// shift the effective $/hr (Complex +$20, At home -$10, Student -$20, Remote
// -$10), and the Travel flat rate. Replaces the previous mess of fixed rates
// like "Complex at home" / "Complex work" / "At home" - those are now derived.
const DEFAULTS = [
  {
    label: "Standard",
    ratePerHour: 65,
    flatRate: null,
    hourlyDelta: null,
    unit: "hour",
    isDefault: true,
  },
  {
    label: "Complex",
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: 20,
    unit: "modifier",
    isDefault: false,
  },
  {
    label: "At home",
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: -10,
    unit: "modifier",
    isDefault: false,
  },
  {
    label: "Student",
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: -20,
    unit: "modifier",
    isDefault: false,
  },
  {
    label: "Remote",
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: -10,
    unit: "modifier",
    isDefault: false,
  },
  {
    label: "Travel",
    ratePerHour: null,
    flatRate: 1.2,
    hourlyDelta: null,
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
  const { label, ratePerHour, flatRate, hourlyDelta, unit, isDefault } = body;

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
      hourlyDelta: hourlyDelta ?? null,
      unit: unit ?? "hour",
      isDefault: isDefault ?? false,
    },
  });

  return NextResponse.json({ ok: true, rate }, { status: 201 });
}

/**
 * DELETE /api/business/rates - Wipes every rate row and reseeds the defaults
 * (Standard base + modifier set + Travel flat rate). Used by the "Reset rates"
 * button in the Calculator's Manage rates panel after the rate-model rework.
 * @param request - Incoming Next.js request
 * @returns JSON with the freshly-seeded rates array
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await prisma.rateConfig.deleteMany({});
  await prisma.rateConfig.createMany({ data: DEFAULTS });
  const rates = await prisma.rateConfig.findMany({ orderBy: { label: "asc" } });
  return NextResponse.json({ ok: true, rates });
}
