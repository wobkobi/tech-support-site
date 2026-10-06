// src/app/api/admin/preview-review-email/route.ts
// Admin endpoint that returns the rendered review ask, for the preview beside the
// "Send a review link" form.

import { buildReviewAskEmail } from "@/features/reviews/lib/email-review-ask";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/preview-review-email
 * Returns the review ask's HTML so the admin can preview it. The stop link uses the
 * "preview" token, which the stop page and route treat as a no-op.
 * Authenticated via X-Admin-Secret header.
 * @param request - The incoming request.
 * @returns JSON response with `{ html, subject }`.
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

    const { reviews } = await getSettings();
    const email = await buildReviewAskEmail(name.trim().split(" ")[0] ?? "", {
      googleUrl: reviews.googleReviewUrl,
      siteFormUrl: "#preview",
      stopUrl: `${getSiteUrl()}/review-asks/stop/preview`,
    });

    return NextResponse.json({ ok: true, html: email.html, subject: email.subject });
  } catch (error) {
    console.error("[admin/preview-review-email] Error:", error);
    return errorResponse("Failed to generate preview.", 500);
  }
}
