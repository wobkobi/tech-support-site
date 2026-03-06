// src/app/api/admin/send-review-link/route.ts
/**
 * @file route.ts
 * @description Admin endpoint to send a review request link to a past client.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { sendPastClientReviewRequest } from "@/features/reviews/lib/email";
import { isValidAdminToken } from "@/shared/lib/auth";

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

    if (!isValidAdminToken(token ?? null)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!name?.trim()) {
      return NextResponse.json({ ok: false, error: "Name is required." }, { status: 400 });
    }
    if (mode === "email" && (!email?.trim() || !email.includes("@"))) {
      return NextResponse.json({ ok: false, error: "Valid email is required." }, { status: 400 });
    }

    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz").replace(
      /\/$/,
      "",
    );

    const reviewRequest = await prisma.reviewRequest.create({
      data: { name: name.trim() },
    });

    const reviewUrl = `${siteUrl}/review?token=${reviewRequest.reviewToken}`;

    if (mode === "sms") {
      return NextResponse.json({ ok: true, reviewUrl });
    }

    await sendPastClientReviewRequest({
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
