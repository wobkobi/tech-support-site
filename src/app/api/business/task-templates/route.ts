// src/app/api/business/task-templates/route.ts
// Admin task-template endpoint: GET lists by usage, POST upserts by description.

import { composeDescription } from "@/features/business/lib/business";
import { canonicalTagMap, canonicaliseTag } from "@/features/business/lib/task-taxonomy";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * Normalises a taxonomy tag: trims, collapses whitespace, and title-cases all-lowercase
 * words. Words with any capital ("PC", "iCloud") stay as typed; {@link canonicaliseTag}
 * then snaps to the existing spelling.
 * @param raw - Raw user/AI-supplied string.
 * @returns Normalised string or null.
 */
function normaliseTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  return cleaned
    .split(" ")
    .map((word) => {
      if (word.length === 0 || /[A-Z]/.test(word)) return word;
      return word[0]!.toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * GET /api/business/task-templates - Returns all saved task templates ordered by usage.
 * @param request - Incoming Next.js request
 * @returns JSON with templates array
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const templates = await prisma.taskTemplate.findMany({
    orderBy: [{ usageCount: "desc" }, { description: "asc" }],
  });

  return NextResponse.json({ ok: true, templates });
}

/**
 * POST /api/business/task-templates - Upserts a task template by description, composed
 * from `device` + `action` when both are given. Bumps usageCount on existing rows.
 * @param request - Request with `defaultPrice`, optional `device` / `action`, and an
 *   optional fallback `description`.
 * @returns JSON with the upserted template.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = await request.json();
  const { description, defaultPrice, device, action } = body as {
    description?: string;
    defaultPrice?: number;
    device?: string;
    action?: string;
  };

  if (typeof defaultPrice !== "number" || isNaN(defaultPrice)) {
    return errorResponse("defaultPrice is required", 400);
  }

  // Snap to the live taxonomy's casing so "pc" joins "PC" instead of forking it.
  const taxonomy = await prisma.taskTemplate.findMany({
    select: { device: true, action: true, usageCount: true },
  });
  const normDevice = canonicaliseTag(normaliseTag(device), canonicalTagMap(taxonomy, "device"));
  const normAction = canonicaliseTag(normaliseTag(action), canonicalTagMap(taxonomy, "action"));
  const fallbackDesc = (description ?? "").trim();
  // composeDescription returns "" when device or action is missing.
  const desc = composeDescription(normDevice, normAction) || fallbackDesc;

  if (!desc) {
    return NextResponse.json(
      { error: "Either description or both device + action are required" },
      { status: 400 },
    );
  }

  const existing = await prisma.taskTemplate.findFirst({
    where: { description: { equals: desc, mode: "insensitive" } },
  });

  if (existing) {
    const updated = await prisma.taskTemplate.update({
      where: { id: existing.id },
      data: {
        defaultPrice,
        usageCount: { increment: 1 },
        // Update tags only when explicitly provided so price-only refreshes don't wipe them.
        ...(normDevice !== null ? { device: normDevice } : {}),
        ...(normAction !== null ? { action: normAction } : {}),
      },
    });
    return NextResponse.json({ ok: true, template: updated });
  }

  const template = await prisma.taskTemplate.create({
    data: {
      description: desc,
      defaultPrice,
      device: normDevice,
      action: normAction,
    },
  });

  return NextResponse.json({ ok: true, template }, { status: 201 });
}
