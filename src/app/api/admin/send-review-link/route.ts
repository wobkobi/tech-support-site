// src/app/api/admin/send-review-link/route.ts
/**
 * @file route.ts
 * @description Admin endpoint to send a review request link to a past client.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendCustomerReviewRequest } from "@/lib/email";
import { timingSafeEqual } from "crypto";

/**
 * Verifies the admin token using timing-safe comparison.
 * @param provided - The token provided in the request.
 * @returns True if the token matches ADMIN_SECRET.
 */
function verifyToken(provided: string): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch {
    return false;
  }
}

/**
 * POST /api/admin/send-review-link
 * Creates a minimal booking record and sends a review request email to a past client.
 * @param request - The incoming request.
 * @returns JSON response indicating success or failure.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      token?: string;
      name?: string;
      email?: string;
      mode?: "email" | "sms";
    };
    const { token, name, email, mode = "email" } = body;

    if (!token || !verifyToken(token)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!name?.trim()) {
      return NextResponse.json({ ok: false, error: "Name is required." }, { status: 400 });
    }
    if (mode === "email" && (!email?.trim() || !email.includes("@"))) {
      return NextResponse.json({ ok: false, error: "Valid email is required." }, { status: 400 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz";

    const reviewRequest = await prisma.reviewRequest.create({
      data: { name: name.trim() },
    });

    const reviewUrl = `${siteUrl}/review?token=${reviewRequest.reviewToken}`;

    if (mode === "sms") {
      return NextResponse.json({ ok: true, reviewUrl });
    }

    await sendCustomerReviewRequest({
      id: reviewRequest.id,
      name: name.trim(),
      email: email!.trim().toLowerCase(),
      reviewToken: reviewRequest.reviewToken,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[admin/send-review-link] Error:", error);
    return NextResponse.json({ ok: false, error: "Failed to send review link." }, { status: 500 });
  }
}
