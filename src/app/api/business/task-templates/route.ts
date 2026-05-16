import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { composeDescription } from "@/features/business/lib/business";

/**
 * Normalises a free-text taxonomy value (device or action): trims, collapses
 * whitespace, and title-cases the first letter of each word so "laptop" /
 * "LAPTOP" / "  laptop  " all dedupe as "Laptop". Returns null for empty input.
 * @param raw - Raw user/AI-supplied string.
 * @returns Normalised string or null.
 */
function normaliseTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (!cleaned) return null;
  return cleaned
    .split(" ")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/**
 * GET /api/business/task-templates - Returns all saved task templates ordered by usage.
 * @param request - Incoming Next.js request
 * @returns JSON with templates array
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const templates = await prisma.taskTemplate.findMany({
    orderBy: [{ usageCount: "desc" }, { description: "asc" }],
  });

  return NextResponse.json({ ok: true, templates });
}

/**
 * POST /api/business/task-templates - Upserts a task template by description.
 * When `device` and `action` are supplied the description is auto-composed as
 * "<device> <action lowercased>" - the client doesn't need to send it.
 * Increments usageCount and updates defaultPrice on existing rows.
 * @param request - Incoming Next.js request with `defaultPrice`, optional `device` / `action`,
 *   and an optional `description` (used as a fallback when device/action are missing).
 * @returns JSON with the upserted template.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { description, defaultPrice, device, action } = body as {
    description?: string;
    defaultPrice?: number;
    device?: string;
    action?: string;
  };

  if (typeof defaultPrice !== "number" || isNaN(defaultPrice)) {
    return NextResponse.json({ error: "defaultPrice is required" }, { status: 400 });
  }

  const normDevice = normaliseTag(device);
  const normAction = normaliseTag(action);
  const fallbackDesc = (description ?? "").trim();
  // Shared composeDescription returns "" when device or action is missing -
  // fall back to the operator-supplied description in that case so old
  // description-only callers keep working.
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
