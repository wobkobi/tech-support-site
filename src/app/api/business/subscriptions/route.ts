import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { VALID_FREQUENCIES } from "@/features/business/lib/constants";

/**
 * GET /api/business/subscriptions - Returns all subscriptions ordered by nextDue ascending.
 * @param request - Incoming Next.js request.
 * @returns JSON with subscriptions array.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const subscriptions = await prisma.subscription.findMany({
    orderBy: { nextDue: "asc" },
  });
  return NextResponse.json({ ok: true, subscriptions });
}

/**
 * POST /api/business/subscriptions - Creates a new subscription.
 * @param request - Incoming Next.js request with subscription data in body.
 * @returns JSON with the created subscription.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    description,
    supplier,
    category,
    amountIncl,
    gstRate,
    method,
    frequency,
    nextDue,
    notes,
  } = body;

  if (!description || !supplier || amountIncl === undefined || !frequency || !nextDue) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!VALID_FREQUENCIES.includes(frequency)) {
    return NextResponse.json({ error: "Invalid frequency" }, { status: 400 });
  }

  const subscription = await prisma.subscription.create({
    data: {
      description,
      supplier,
      category: category ?? "Subscriptions",
      amountIncl: Number(amountIncl),
      gstRate: gstRate !== undefined ? Number(gstRate) : 0.15,
      method: method ?? "Business Account",
      frequency,
      nextDue: new Date(nextDue),
      isActive: true,
      notes: notes ?? null,
    },
  });

  return NextResponse.json({ ok: true, subscription }, { status: 201 });
}
