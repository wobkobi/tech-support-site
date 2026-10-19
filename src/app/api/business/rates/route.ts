// src/app/api/business/rates/route.ts
// Admin rate-config collection endpoint. GET seeds missing DEFAULT_RATE_ROWS and runs
// passive migrations; POST creates a rate; DELETE wipes and reseeds the defaults.

import { DEFAULT_RATE_ROWS } from "@/features/business/lib/pricing-policy";
import { RATE_CONFIG_TAG } from "@/features/business/lib/pricing-policy.server";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { SETTINGS_KEY_PREFIX } from "@/shared/lib/settings/get-settings";
import { saveSettingsGroup } from "@/shared/lib/settings/set-settings";
import type { Settings } from "@/shared/lib/settings/types";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/business/rates - Returns all rate configs, seeding any missing defaults on each call.
 * @param request - Incoming Next.js request
 * @returns JSON with rates array
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  // Decide migrations in memory so the steady state stays a single read (the
  // admin calculator hits this on every mount).
  let rates = await prisma.rateConfig.findMany({ orderBy: { label: "asc" } });

  const existingLabels = new Set(rates.map((r) => r.label));
  const missing = DEFAULT_RATE_ROWS.filter((d) => !existingLabels.has(d.label));
  if (missing.length > 0) {
    await prisma.rateConfig.createMany({ data: missing });
  }

  // Passive cleanup: Student and Complex are no longer part of DEFAULT_RATE_ROWS.
  const hasRetiredLabels = rates.some((r) => r.label === "Student" || r.label === "Complex");
  if (hasRetiredLabels) {
    await prisma.rateConfig.deleteMany({ where: { label: { in: ["Student", "Complex"] } } });
  }

  // Travel-row retirement: carry a row's rate into pricing settings if they state none
  // (a customised rate must never reset), then delete the rows.
  const travelRows = rates.filter((r) => r.unit === "travel-hour" || r.unit === "km");
  let travelRetired = false;
  if (travelRows.length > 0) {
    const rowRate = travelRows.find((r) => r.ratePerHour != null)?.ratePerHour;
    try {
      if (rowRate != null) {
        const raw = await prisma.setting.findUnique({
          where: { key: SETTINGS_KEY_PREFIX + "pricing" },
        });
        // Sparse blob: add only the key; resolveSettings fills the rest from defaults.
        const blob = raw?.value ? (JSON.parse(raw.value) as Record<string, unknown>) : {};
        if (blob.travelRatePerHour === undefined) {
          await saveSettingsGroup("pricing", {
            ...blob,
            travelRatePerHour: rowRate,
          } as Settings["pricing"]);
        }
      }
      await prisma.rateConfig.deleteMany({ where: { id: { in: travelRows.map((r) => r.id) } } });
      travelRetired = true;
    } catch (err) {
      // Leave the row in place so the next GET retries the carry-over.
      console.warn("[rates] travel-row retirement failed; will retry:", err);
    }
  }

  // updatedAt backfill: an unset Mongo field reads back as null, so the null check
  // covers both. Stamp "now" once for the pricing-page footer.
  const needsUpdatedAtBackfill = rates.some((r) => r.updatedAt === null);
  if (needsUpdatedAtBackfill) {
    await prisma.rateConfig.updateMany({
      where: { OR: [{ updatedAt: { isSet: false } }, { updatedAt: null }] },
      data: { updatedAt: new Date() },
    });
  }

  // Re-read and bust the public pricing cache only when a migration wrote.
  if (missing.length > 0 || hasRetiredLabels || travelRetired || needsUpdatedAtBackfill) {
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

  // Reject NaN/Infinity: rates feed the public estimator and AI calculator.
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

  // Clear other defaults only after the create succeeds.
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
 * (Standard base + modifier set).
 * @param request - Incoming Next.js request
 * @returns JSON with the freshly-seeded rates array
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }
  await prisma.rateConfig.deleteMany({});
  await prisma.rateConfig.createMany({ data: DEFAULT_RATE_ROWS });
  const rates = await prisma.rateConfig.findMany({ orderBy: { label: "asc" } });
  // Next 16's revalidateTag requires a second CacheLifeConfig arg.
  revalidateTag(RATE_CONFIG_TAG, {});
  return NextResponse.json({ ok: true, rates });
}
