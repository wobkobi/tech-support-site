// src/app/api/admin/reviews/[id]/route.ts
/**
 * @file route.ts
 * @description Admin API for approving, revoking, and deleting reviews.
 * Protected by ADMIN_SECRET via constant-time comparison.
 */

import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Validates an admin token against ADMIN_SECRET using a constant-time comparison.
 * @param token - Token to validate.
 * @returns True if the token matches ADMIN_SECRET.
 */
function isValidToken(token: string | null | undefined): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !token) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

/**
 * PATCH /api/admin/reviews/[id]
 * Approves or revokes a review.
 * @param request - Incoming request with { action, token } body.
 * @param params - Route params containing the review id.
 * @returns JSON response.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const body = (await request.json()) as { action?: string; token?: string };

  if (!isValidToken(body.token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { action } = body;
  if (action !== "approve" && action !== "revoke") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const { id } = await params;

  try {
    await prisma.review.update({
      where: { id },
      data: { approved: action === "approve" },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[admin/reviews] PATCH error for ${id}:`, error);
    return NextResponse.json({ error: "Failed to update review" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/reviews/[id]
 * Permanently deletes a review.
 * @param request - Incoming request with ?token= query param.
 * @param params - Route params containing the review id.
 * @returns JSON response.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");

  if (!isValidToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await prisma.review.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[admin/reviews] DELETE error for ${id}:`, error);
    return NextResponse.json({ error: "Failed to delete review" }, { status: 500 });
  }
}
