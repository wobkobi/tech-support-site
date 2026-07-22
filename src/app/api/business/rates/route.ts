// src/app/api/business/rates/route.ts
/**
 * @description Admin rate-config collection endpoint. GET returns every rate,
 * seeding any missing DEFAULTS and running passive migrations (drop Student /
 * Complex, retire the Travel row into the pricing settings, backfill
 * updatedAt). POST creates a rate (clearing other defaults when isDefault is
 * set); DELETE wipes all rows and reseeds the DEFAULTS.
 */

import { RATE_CONFIG_TAG } from "@/features/business/lib/pricing-policy.server";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { SETTINGS_KEY_PREFIX } from "@/shared/lib/settings/get-settings";
import { saveSettingsGroup } from "@/shared/lib/settings/set-settings";
import type { Settings } from "@/shared/lib/settings/types";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

// Seed shape: one base hourly rate (Standard), modifier rates that shift the
// effective $/hr (At home -$10, Remote -$10), and a percentage modifier for
// Public Holiday (+25%). There is no separate Complex tier - everything bills
// at the Standard rate plus the other modifiers. The travel $/hr is a pricing
// setting (Settings > Pricing), not a rate row.
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
    // Phone-delivered work: no screen share, no travel - cheaper again than
    // Remote. Quick calls are often not charged at all (operator's call);
    // this rate covers the ones long enough to bill.
    label: "Phone",
    ratePerHour: null,
    flatRate: null,
    hourlyDelta: -25,
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

  // Travel-row retirement: the travel $/hr is a pricing setting now. Carry a
  // surviving row's rate into the settings blob first when the blob doesn't
  // state one yet - a customised rate must never silently reset to the
  // default - then delete the row(s) so the rate panel can no longer edit the
  // rate. Legacy per-km rows carry no hourly rate; they just delete.
  const travelRows = rates.filter((r) => r.unit === "travel-hour" || r.unit === "km");
  let travelRetired = false;
  if (travelRows.length > 0) {
    const rowRate = travelRows.find((r) => r.ratePerHour != null)?.ratePerHour;
    try {
      if (rowRate != null) {
        const raw = await prisma.setting.findUnique({
          where: { key: SETTINGS_KEY_PREFIX + "pricing" },
        });
        // Sparse blob: only operator-set keys exist; resolveSettings fills the
        // rest from defaults, so add the key rather than a full group value.
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
