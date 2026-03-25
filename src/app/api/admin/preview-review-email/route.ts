// src/app/api/admin/preview-review-email/route.ts
/**
 * @file route.ts
 * @description Admin endpoint that returns the rendered HTML preview for a past-client review email.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildPastClientReviewEmailHtml } from "@/features/reviews/lib/email";
import { isValidAdminToken } from "@/shared/lib/auth";

/**
 * POST /api/admin/preview-review-email
 * Returns the rendered HTML for a past-client review request email so the admin can preview it.
 * @param request - The incoming request.
 * @returns JSON response with `{ html }`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { token?: string; name?: string };
    const { token, name } = body;

    if (!isValidAdminToken(token ?? null)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    if (!name?.trim()) {
      return NextResponse.json({ ok: false, error: "Name is required." }, { status: 400 });
    }

    const firstName = name.trim().split(" ")[0];
    const html = buildPastClientReviewEmailHtml(firstName, "#preview");

    return NextResponse.json({ ok: true, html });
  } catch (error) {
    console.error("[admin/preview-review-email] Error:", error);
    return NextResponse.json({ ok: false, error: "Failed to generate preview." }, { status: 500 });
  }
}
