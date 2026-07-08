// src/app/api/business/rates/route.ts
/**
 * @description Admin rate-config collection endpoint. GET returns every rate,
 * seeding any missing DEFAULTS and running passive migrations (drop Student /
 * Complex, convert legacy per-km Travel to time-based, backfill updatedAt).
 * POST creates a rate (clearing other defaults when isDefault is set); DELETE
 * wipes all rows and reseeds the DEFAULTS.
 */

import { RATE_CONFIG_TAG } from "@/features/business/lib/pricing-policy.server";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

// Seed shape: one base hourly rate (Standard), modifier rates that shift the
// effective $/hr (At home -$10, Remote -$10), a percentage modifier for Public
// Holiday (+25%), and the Travel time rate. There is no separate Complex tier
// - everything bills at the Standard rate plus the other modifiers.
const DEFAULTS = [
  {
    label: "Standard",
    ratePerHour: 65,
    flatRate: null,
    hourlyDelta: null,
    percentDelta: null,
    unit: "hour",
    isDefault: true,
  },
  {
    label: "At home",
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: -10,
    percentDelta: null,
    unit: "modifier",
    isDefault: false,
  },
  {
    label: "Remote",
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: -10,
    percentDelta: null,
    unit: "modifier",
    isDefault: false,
  },
  {
    label: "Public Holiday",
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: null,
    percentDelta: 0.25,
    unit: "modifier",
    isDefault: false,
  },
  {
    label: "Travel",
    // Time-based travel rate ($40/hr round-trip, $10 minimum) - sidesteps any
    // IRD per-km comparison and matches "you pay for my time, including drive
    // time". Round-trip + floor enforcement live in calcTravelCharge.
    ratePerHour: 40,
    flatRate: null,
    hourlyDelta: null,
    percentDelta: null,
    unit: "travel-hour",
    isDefault: false,
  },
];

/**
 * GET /api/business/rates - Returns all rate configs, seeding any missing defaults on each call.
 * @param request - Incoming Next.js request
 * @returns JSON with rates array
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  // Read once and decide in memory which passive migrations still apply, so
  // the steady state (nothing to migrate) stays a single read - the admin
  // calculator hits this endpoint on every mount.
  let rates = await prisma.rateConfig.findMany({ orderBy: { label: "asc" } });

  const existingLabels = new Set(rates.map((r) => r.label));
  const missing = DEFAULTS.filter((d) => !existingLabels.has(d.label));
  if (missing.length > 0) {
    await prisma.rateConfig.createMany({ data: missing });
  }

  // Passive cleanup: Student and Complex are no longer part of DEFAULTS.
  const hasRetiredLabels = rates.some((r) => r.label === "Student" || r.label === "Complex");
  if (hasRetiredLabels) {
    await prisma.rateConfig.deleteMany({ where: { label: { in: ["Student", "Complex"] } } });
  }

  // Travel rate migration: legacy rows still carry { flatRate: 1.2, unit: "km" }
  // from the per-km model. Switch to { ratePerHour: 40, unit: "travel-hour" }
  // so time-based travel math (calcTravelCharge) reads the correct rate.
  const hasLegacyTravel = rates.some((r) => r.label === "Travel" && r.unit === "km");
  if (hasLegacyTravel) {
    await prisma.rateConfig.updateMany({
      where: { label: "Travel", unit: "km" },
      data: { ratePerHour: 40, flatRate: null, unit: "travel-hour" },
    });
  }

  // updatedAt backfill: rows created before the field existed have no value in
  // Mongo; an unset nullable field reads back as null, so the null check covers
  // both unset and explicit-null rows. Stamp them once with "now" so the
  // pricing-page footer has something to show; future edits stamp via @updatedAt.
  const needsUpdatedAtBackfill = rates.some((r) => r.updatedAt === null);
  if (needsUpdatedAtBackfill) {
    await prisma.rateConfig.updateMany({
      where: { OR: [{ updatedAt: { isSet: false } }, { updatedAt: null }] },
      data: { updatedAt: new Date() },
    });
  }

  // Re-read and bust the public pricing cache only when a migration wrote.
  if (missing.length > 0 || hasRetiredLabels || hasLegacyTravel || needsUpdatedAtBackfill) {
    rates = await prisma.rateConfig.findMany({ orderBy: { label: "asc" } });
    // Next 16's revalidateTag requires a second CacheLifeConfig arg.
    revalidateTag(RATE_CONFIG_TAG, {});
  }

  return NextResponse.json({ ok: true, rates });
}

/**
 * POST /api/business/rates - Creates a new rate configuration.
 * @param request - Incoming Next.js request with rate data in body
 * @returns JSON with the created rate
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = await request.json();
  const { label, ratePerHour, flatRate, hourlyDelta, percentDelta, unit, isDefault } = body;

  if (!label || typeof label !== "string") {
    return errorResponse("label is required", 400);
  }

  // Reject non-finite numerics before they reach Prisma (NaN from an empty form
  // field, Infinity from a crafted body) - these values feed the public
  // estimator and the AI calculator, so a bad rate must never persist.
  for (const [key, val] of Object.entries({ ratePerHour, flatRate, hourlyDelta, percentDelta })) {
    if (val !== undefined && val !== null && !Number.isFinite(val)) {
      return errorResponse(`Invalid ${key}`, 400);
    }
  }

  const rate = await prisma.rateConfig.create({
    data: {
      label,
      ratePerHour: ratePerHour ?? null,
      flatRate: flatRate ?? null,
      hourlyDelta: hourlyDelta ?? null,
      percentDelta: percentDelta ?? null,
      unit: unit ?? "hour",
      isDefault: isDefault ?? false,
    },
  });

  // Clear the default flag on the other rows only after the new row is created -
  // a failed create must not wipe every default and leave zero default rates.
  if (isDefault) {
    await prisma.rateConfig.updateMany({
      where: { id: { not: rate.id } },
      data: { isDefault: false },
    });
  }

  // Next 16's revalidateTag requires a second CacheLifeConfig arg.
  revalidateTag(RATE_CONFIG_TAG, {});
  return NextResponse.json({ ok: true, rate }, { status: 201 });
}

/**
 * DELETE /api/business/rates - Wipes every rate row and reseeds the defaults
 * (Standard base + modifier set + Travel flat rate).
 * @param request - Incoming Next.js request
 * @returns JSON with the freshly-seeded rates array
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }
  await prisma.rateConfig.deleteMany({});
  await prisma.rateConfig.createMany({ data: DEFAULTS });
  const rates = await prisma.rateConfig.findMany({ orderBy: { label: "asc" } });
  // Next 16's revalidateTag requires a second CacheLifeConfig arg.
  revalidateTag(RATE_CONFIG_TAG, {});
  return NextResponse.json({ ok: true, rates });
}
