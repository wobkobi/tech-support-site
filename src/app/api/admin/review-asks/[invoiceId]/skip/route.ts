// src/app/api/admin/review-asks/[invoiceId]/skip/route.ts
// Admin "Skip" on an upcoming review ask: stamps the invoice cancelled so the daily job
// leaves it alone. Refuses once the ask is sending or sent.

import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/review-asks/[invoiceId]/skip
 * @param request - Incoming admin request.
 * @param ctx - Route context.
 * @param ctx.params - Route params with the invoice id.
 * @returns JSON `{ ok }`, or 409 when the ask is no longer open.
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
    // Conditional on the ask still being open, so a send already under way is never
    // relabelled as skipped.
    const { count } = await prisma.invoice.updateMany({
      where: {
        id: invoiceId,
        OR: [
          { reviewAskOutcome: null },
          { reviewAskOutcome: { isSet: false } },
          { reviewAskOutcome: "failed" },
        ],
      },
      data: {
        reviewAskOutcome: "cancelled",
        reviewAskNote: "skipped_in_admin",
        reviewAskDecidedAt: new Date(),
      },
    });
    if (count === 0) {
      return errorResponse("This review ask has already gone out or been decided.", 409);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[admin/review-asks/${invoiceId}/skip] Error:`, error);
    return errorResponse("Couldn't skip the review ask.", 500);
  }
}
