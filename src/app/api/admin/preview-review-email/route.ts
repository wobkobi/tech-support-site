// src/app/api/admin/preview-review-email/route.ts
/**
 * @file route.ts
 * @description Admin endpoint that returns the rendered HTML preview for a past-client review email.
 */

import { buildPastClientReviewEmailHtml } from "@/features/reviews/lib/email";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/preview-review-email
 * Returns the rendered HTML for a past-client review request email so the admin can preview it.
 * Authenticated via X-Admin-Secret header.
 * @param request - The incoming request.
 * @returns JSON response with `{ html }`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const body = (await request.json()) as { name?: string };
    const { name } = body;

    if (!name?.trim()) {
      return errorResponse("Name is required.", 400);
    }

    const firstName = name.trim().split(" ")[0];
    const html = await buildPastClientReviewEmailHtml(firstName, "#preview");

    return NextResponse.json({ ok: true, html });
  } catch (error) {
    console.error("[admin/preview-review-email] Error:", error);
    return errorResponse("Failed to generate preview.", 500);
  }
}
