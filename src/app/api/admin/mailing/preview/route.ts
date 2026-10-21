// src/app/api/admin/mailing/preview/route.ts
// Renders unsaved editor content exactly as a recipient would get it, for the live preview.

import {
  loadSharedRenderParts,
  mailingFrom,
  unsubscribePageUrl,
} from "@/features/mailing/lib/context";
import { listProblems, renderCampaign, SAMPLE_REVIEW_TEXT } from "@/features/mailing/lib/render";
import { parseCampaignPatch } from "@/features/mailing/lib/validate";
import { errorResponse, okResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getSiteUrl } from "@/shared/lib/site-url";
import { NextRequest, NextResponse } from "next/server";

/** Sample recipient for the preview, so placeholders read naturally. */
const SAMPLE_NAME = "Sam Taylor";

/** How much of the inbox line to send; the card cuts it to fit anyway. */
const INBOX_LINE_MAX = 200;

/**
 * The name an inbox shows for a From value like `"Name" <a@b.nz>`: the name, else the address.
 * @param from - From value.
 * @returns Sender name.
 */
function senderName(from: string): string {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from);
  return m ? m[1] || m[2]! : from.trim();
}

/**
 * POST /api/admin/mailing/preview
 * Body: `{ subject, preheader, body, promoId, audience }`.
 * @param request - Incoming request.
 * @returns JSON `{ subject, from, inboxLine, html, problems }`: the inbox line is the preview
 *   text with the start of the email after it, the way most inboxes run them together.
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
      // The unsubscribe page explains the "preview" token instead of acting on it.
      { ...parts, unsubscribeUrl: unsubscribePageUrl("preview") },
    );
    const problems = listProblems(content, parts.promo !== null, audience);
    if (!parts.linkedPromoLive) {
      problems.unshift("The promo this email is linked to has ended or been switched off.");
    }
    // Preview only: site images load from this server, so one that isn't deployed yet still
    // shows, and links open in a new tab instead of inside the frame.
    const html = email.html
      .replaceAll(`src="${getSiteUrl()}/`, `src="${request.nextUrl.origin}/`)
      .replace("<head>", '<head><base target="_blank">');
    const inboxLine = [email.preheader, email.text]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, INBOX_LINE_MAX);
    const from = senderName(mailingFrom() ?? parts.brand);
    return okResponse({ subject: email.subject, from, inboxLine, html, problems });
  } catch (error) {
    console.error("[admin/mailing/preview] Error:", error);
    return errorResponse("Couldn't build the preview.", 500);
  }
}
