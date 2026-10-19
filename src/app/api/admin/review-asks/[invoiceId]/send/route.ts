// src/app/api/admin/review-asks/[invoiceId]/send/route.ts
// Admin "Send now" for a review ask, via the daily job's claim-send-stamp path (no delay or
// gap) so both can't send. Opt-outs still apply.

import { reviewAskNoteLabel } from "@/features/reviews/lib/review-ask-rules";
import { runReviewAsks } from "@/features/reviews/lib/review-ask-run.server";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/review-asks/[invoiceId]/send
 * @param request - Incoming admin request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the invoice id.
 * @returns JSON `{ ok }`, or an error saying why nothing was sent.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { invoiceId } = await params;
  try {
    const result = await runReviewAsks(new Date(), { onlyInvoiceId: invoiceId, force: true });
    if (result.sent > 0) return NextResponse.json({ ok: true });
    if (result.stopped === "not_configured") {
      return errorResponse("Email isn't set up, so nothing was sent.", 503);
    }
    if (result.blockedBy === "already_decided") {
      return errorResponse("This review ask has already gone out or been decided.", 409);
    }
    if (result.blockedBy && result.blockedBy !== "not_due") {
      return errorResponse(`Not sent: ${reviewAskNoteLabel(result.blockedBy)}.`, 409);
    }
    return errorResponse("The review ask didn't send. Try again in a minute.", 502);
  } catch (error) {
    console.error(`[admin/review-asks/${invoiceId}/send] Error:`, error);
    return errorResponse("Couldn't send the review ask.", 500);
  }
}
