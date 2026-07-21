// src/app/api/business/subscriptions/[id]/route.ts
/**
 * @description Admin single-subscription endpoint. PATCH validates frequency,
 * amount, and GST rate when present and applies a sparse update; DELETE removes
 * the subscription.
 */

import { VALID_FREQUENCIES } from "@/features/business/lib/constants";
import { parseAmount, parseRate } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow Sheets round-trip cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * PATCH /api/business/subscriptions/[id] - Updates a subscription's fields.
 * @param request - Incoming Next.js request with fields to update in body.
 * @param root0 - Route context.
 * @param root0.params - Route params promise.
 * @returns JSON with the updated subscription.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;
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
    isActive,
    notes,
  } = body;

  if (frequency && !(VALID_FREQUENCIES as readonly string[]).includes(frequency)) {
    return errorResponse("Invalid frequency", 400);
  }

  let safeAmount: number | undefined;
  if (amountIncl !== undefined) {
    const parsed = parseAmount(amountIncl);
    if (parsed === null) {
      return errorResponse("Invalid amount", 400);
    }
    safeAmount = parsed;
  }

  let safeRate: number | undefined;
  if (gstRate !== undefined) {
    const parsed = parseRate(gstRate);
    if (parsed === null) {
      return errorResponse("Invalid GST rate", 400);
    }
    safeRate = parsed;
  }

  // Reject an unparseable nextDue before it reaches Prisma as an Invalid Date
  // (which would surface as a 500 rather than a clean 400).
  if (nextDue !== undefined && Number.isNaN(new Date(nextDue).getTime())) {
    return errorResponse("Invalid nextDue date", 400);
  }

  try {
    const subscription = await prisma.subscription.update({
      where: { id },
      data: {
        ...(description !== undefined && { description }),
        ...(supplier !== undefined && { supplier }),
        ...(category !== undefined && { category }),
        ...(safeAmount !== undefined && { amountIncl: safeAmount }),
        ...(safeRate !== undefined && { gstRate: safeRate }),
        ...(method !== undefined && { method }),
        ...(frequency !== undefined && { frequency }),
        ...(nextDue !== undefined && { nextDue: new Date(nextDue) }),
        ...(isActive !== undefined && { isActive }),
        ...(notes !== undefined && { notes }),
      },
    });
    return NextResponse.json({ ok: true, subscription });
  } catch {
    // Missing/stale id (Prisma P2025) - match the 404 the other [id] routes return.
    return errorResponse("Subscription not found", 404);
  }
}

/**
 * DELETE /api/business/subscriptions/[id] - Deletes a subscription.
 * @param request - Incoming Next.js request.
 * @param root0 - Route context.
 * @param root0.params - Route params promise.
 * @returns JSON confirming deletion.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;
  try {
    await prisma.subscription.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    // Missing/stale id (Prisma P2025) - match the 404 the other [id] routes return.
    return errorResponse("Subscription not found", 404);
  }
}
