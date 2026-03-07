// src/app/api/admin/reviews/[id]/route.ts
/**
 * @file route.ts
 * @description Admin API for approving, revoking, and deleting reviews.
 * Protected by ADMIN_SECRET via constant-time comparison.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/shared/lib/prisma";
import { isValidAdminToken } from "@/shared/lib/auth";

/**
 * PATCH /api/admin/reviews/[id]
 * Approves or revokes a review.
 * @param request - Incoming request with { action, token } body.
 * @param params - Route segment params wrapper.
 * @param params.params - Promise resolving to the route segment containing the review ID.
 * @returns JSON response.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const body = (await request.json()) as { action?: string; token?: string };

  if (!isValidAdminToken(body.token)) {
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
      data: { status: action === "approve" ? "approved" : "pending" },
    });

    // Trigger ISR revalidation so public pages update immediately
    revalidatePath("/reviews");
    revalidatePath("/review");
    revalidatePath("/");

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
 * @param params - Route segment params wrapper.
 * @param params.params - Promise resolving to the route segment containing the review ID.
 * @returns JSON response.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get("token");

  if (!isValidAdminToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await prisma.review.delete({ where: { id } });

    // Trigger ISR revalidation so public pages update immediately
    revalidatePath("/reviews");
    revalidatePath("/review");
    revalidatePath("/");

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[admin/reviews] DELETE error for ${id}:`, error);
    return NextResponse.json({ error: "Failed to delete review" }, { status: 500 });
  }
}
