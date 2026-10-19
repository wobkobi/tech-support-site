// src/app/api/business/subscriptions/route.ts
// Admin subscription collection endpoint: GET lists by nextDue, POST validates and
// creates, refusing a duplicate active supplier+description.

import { VALID_FREQUENCIES } from "@/features/business/lib/constants";
import { parseAmount, parseDate, parseRate } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * Whether a subscription is the same repeat cost as a supplier+description pair,
 * ignoring case and surrounding spaces.
 * @param sub - Existing subscription's supplier and description.
 * @param sub.supplier - Existing supplier.
 * @param sub.description - Existing description.
 * @param supplier - Incoming supplier.
 * @param description - Incoming description.
 * @returns True when both fields match.
 */
function sameKey(
  sub: { supplier: string; description: string },
  supplier: unknown,
  description: unknown,
): boolean {
  return (
    sub.supplier.trim().toLowerCase() === String(supplier).trim().toLowerCase() &&
    sub.description.trim().toLowerCase() === String(description).trim().toLowerCase()
  );
}

/**
 * GET /api/business/subscriptions - Returns all subscriptions ordered by nextDue ascending.
 * @param request - Incoming Next.js request.
 * @returns JSON with subscriptions array.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
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
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
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
    return errorResponse("Missing required fields", 400);
  }
  if (!VALID_FREQUENCIES.includes(frequency)) {
    return errorResponse("Invalid frequency", 400);
  }

  const safeAmount = parseAmount(amountIncl);
  if (safeAmount === null) {
    return errorResponse("Invalid amount", 400);
  }
  const safeRate = gstRate === undefined ? 0.15 : parseRate(gstRate);
  if (safeRate === null) {
    return errorResponse("Invalid GST rate", 400);
  }

  const nextDueValue = parseDate(nextDue);
  if (nextDueValue === null) {
    return errorResponse("Invalid nextDue date", 400);
  }

  // Refuse only an exact supplier+description copy, which the cron would book twice.
  // A supplier may have several subscriptions.
  const active = await prisma.subscription.findMany({
    where: { isActive: true },
    select: { supplier: true, description: true },
  });
  if (active.some((s) => sameKey(s, supplier, description))) {
    return errorResponse(`${supplier} "${description}" is already an active subscription.`, 409);
  }

  const subscription = await prisma.subscription.create({
    data: {
      description,
      supplier,
      category: category ?? "Subscriptions",
      amountIncl: safeAmount,
      gstRate: safeRate,
      method: method ?? "Business Account",
      frequency,
      nextDue: nextDueValue,
      isActive: true,
      notes: notes ?? null,
    },
  });

  return NextResponse.json({ ok: true, subscription }, { status: 201 });
}
