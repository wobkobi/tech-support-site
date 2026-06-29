// src/app/api/business/subscriptions/route.ts
/**
 * @description Admin subscription collection endpoint. GET lists all
 * subscriptions ordered by nextDue ascending; POST validates required fields,
 * frequency, amount, and GST rate, then creates an active subscription.
 */

import { VALID_FREQUENCIES } from "@/features/business/lib/constants";
import { parseAmount, parseRate } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

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

  const subscription = await prisma.subscription.create({
    data: {
      description,
      supplier,
      category: category ?? "Subscriptions",
      amountIncl: safeAmount,
      gstRate: safeRate,
      method: method ?? "Business Account",
      frequency,
      nextDue: new Date(nextDue),
      isActive: true,
      notes: notes ?? null,
    },
  });

  return NextResponse.json({ ok: true, subscription }, { status: 201 });
}
