// src/app/api/admin/mailing/preview/route.ts
// Renders unsaved editor content exactly as a recipient would get it, for the live preview.

import { loadSharedRenderParts } from "@/features/mailing/lib/context";
import { listProblems, renderCampaign, SAMPLE_REVIEW_TEXT } from "@/features/mailing/lib/render";
import { parseCampaignPatch } from "@/features/mailing/lib/validate";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/** Sample recipient for the preview, so placeholders read naturally. */
const SAMPLE_NAME = "Sam Taylor";

/**
 * POST /api/admin/mailing/preview
 * Body: `{ subject, preheader, body, promoId, audience }`.
 * @param request - Incoming request.
 * @returns JSON `{ subject, html, problems }`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const parsed = parseCampaignPatch(await request.json().catch(() => null));
  if ("error" in parsed) return errorResponse(parsed.error, 400);
  const {
    subject = "",
    preheader = null,
    body = "",
    promoId = null,
    audience = "everyone",
  } = parsed.patch;

  try {
    const parts = await loadSharedRenderParts(promoId);
    const content = { subject, preheader, body };
    const email = renderCampaign(
      content,
      { name: SAMPLE_NAME, reviewText: SAMPLE_REVIEW_TEXT },
      { ...parts, unsubscribeUrl: "#" },
    );
    const problems = listProblems(content, parts.promo !== null, audience);
    if (!parts.linkedPromoLive) {
      problems.unshift("The promo this email is linked to has ended or been switched off.");
    }
    return okResponse({ subject: email.subject, html: email.html, problems });
  } catch (error) {
    console.error("[admin/mailing/preview] Error:", error);
    return errorResponse("Couldn't build the preview.", 500);
  }
}
