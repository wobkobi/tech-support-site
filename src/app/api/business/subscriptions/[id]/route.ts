import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { VALID_FREQUENCIES } from "@/features/business/lib/constants";

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

  const subscription = await prisma.subscription.update({
    where: { id },
    data: {
      ...(description !== undefined && { description }),
      ...(supplier !== undefined && { supplier }),
      ...(category !== undefined && { category }),
      ...(amountIncl !== undefined && { amountIncl: Number(amountIncl) }),
      ...(gstRate !== undefined && { gstRate: Number(gstRate) }),
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
