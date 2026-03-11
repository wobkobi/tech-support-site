// src/app/api/admin/review-requests/[id]/route.ts
/**
 * @file route.ts
 * @description Admin endpoint to update or revoke a review request.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isValidAdminToken } from "@/shared/lib/auth";
import { toE164NZ, isValidPhone } from "@/shared/lib/normalize-phone";

/**
 * PATCH /api/admin/review-requests/[id]
 * Updates name, email, and/or phone on an existing ReviewRequest.
 * @param request - The incoming request.
 * @param params - Route params containing the ReviewRequest id.
 * @param params.params - Promise resolving to an object with the id param.
 * @returns JSON response indicating success or failure.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = (await request.json()) as {
      token?: string;
      name?: string;
      email?: string;
      phone?: string;
    };
    const { token, name, email, phone } = body;

    if (!isValidAdminToken(token ?? null)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!name?.trim()) {
      return NextResponse.json({ ok: false, error: "Name is required." }, { status: 400 });
    }

    const normalizedPhone = phone ? toE164NZ(phone) : "";
    if (!isValidPhone(normalizedPhone)) {
      return NextResponse.json({ ok: false, error: "Invalid phone number." }, { status: 400 });
    }

    await prisma.reviewRequest.update({
      where: { id },
      data: {
        name: name.trim(),
        email: email?.trim().toLowerCase() || null,
        phone: normalizedPhone || null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin/review-requests/PATCH] Error:", error);
    return NextResponse.json({ ok: false, error: "Failed to update." }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/review-requests/[id]
 * Revokes a review link by deleting the ReviewRequest record so the token is no longer valid.
 * @param request - The incoming request with ?token= query param.
 * @param params - Route params containing the ReviewRequest id.
 * @param params.params - The dynamic route params promise.
 * @returns JSON response indicating success or failure.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const adminToken = request.nextUrl.searchParams.get("token");

  if (!isValidAdminToken(adminToken)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await prisma.reviewRequest.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[admin/review-requests] DELETE error for ${id}:`, error);
    return NextResponse.json({ ok: false, error: "Failed to revoke." }, { status: 500 });
  }
}
