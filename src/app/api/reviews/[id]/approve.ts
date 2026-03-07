// src/app/api/reviews/[id]/approve.ts
/**
 * @file approve.ts
 * @description POST /api/reviews/[id]/approve - Admin endpoint to approve a review (sets status: approved).
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";

/**
 * POST /api/reviews/[id]/approve - Approves a review (sets status: approved).
 * @param request - The incoming request.
 * @param root0 - Route params wrapper.
 * @param root0.params - Route segment params.
 * @param root0.params.id - The review ID.
 * @returns JSON response indicating success or failure.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { id } = params;
  const review = await prisma.review.findUnique({ where: { id } });
  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }
  await prisma.review.update({ where: { id }, data: { status: "approved" } });

  // Trigger ISR revalidation so public pages update immediately
  revalidatePath("/reviews");
  revalidatePath("/review");
  revalidatePath("/");

  return NextResponse.json({ ok: true }, { status: 200 });
}
