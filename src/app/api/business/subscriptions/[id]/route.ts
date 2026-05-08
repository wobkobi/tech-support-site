import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { VALID_FREQUENCIES } from "@/features/business/lib/constants";
import { parseAmount, parseRate } from "@/features/business/lib/validation";

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
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    return NextResponse.json({ error: "Invalid frequency" }, { status: 400 });
  }

  let safeAmount: number | undefined;
  if (amountIncl !== undefined) {
    const parsed = parseAmount(amountIncl);
    if (parsed === null) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    safeAmount = parsed;
  }

  let safeRate: number | undefined;
  if (gstRate !== undefined) {
    const parsed = parseRate(gstRate);
    if (parsed === null) {
      return NextResponse.json({ error: "Invalid GST rate" }, { status: 400 });
    }
    safeRate = parsed;
  }

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
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await prisma.subscription.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
