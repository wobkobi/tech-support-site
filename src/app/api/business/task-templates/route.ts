import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

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
 * POST /api/business/task-templates - Upserts a task template by description (case-insensitive).
 * Increments usageCount and updates defaultPrice if it already exists.
 * @param request - Incoming Next.js request with description and defaultPrice in body
 * @returns JSON with the upserted template
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { description, defaultPrice } = body as { description?: string; defaultPrice?: number };

  if (!description || typeof description !== "string" || !description.trim()) {
    return NextResponse.json({ error: "description is required" }, { status: 400 });
  }
  if (typeof defaultPrice !== "number" || isNaN(defaultPrice)) {
    return NextResponse.json({ error: "defaultPrice is required" }, { status: 400 });
  }

  const desc = description.trim();

  const existing = await prisma.taskTemplate.findFirst({
    where: { description: { equals: desc, mode: "insensitive" } },
  });

  if (existing) {
    const updated = await prisma.taskTemplate.update({
      where: { id: existing.id },
      data: { defaultPrice, usageCount: { increment: 1 } },
    });
    return NextResponse.json({ ok: true, template: updated });
  }

  const template = await prisma.taskTemplate.create({
    data: { description: desc, defaultPrice },
  });

  return NextResponse.json({ ok: true, template }, { status: 201 });
}
