// src/app/api/cron/send-review-asks/route.ts
// Daily cron sending the Google review ask a few days after each invoice goes out, and
// stamping why when it doesn't. Idempotent: every invoice is decided once, and a send
// carries a per-invoice idempotency key. See docs/CRON.md.

import { runReviewAsks } from "@/features/reviews/lib/review-ask-run.server";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/send-review-asks
 * Optional `?invoiceId=` limits the run to one invoice, for testing against a database
 * full of real invoices.
 * @param request - Incoming cron request.
 * @returns JSON `{ ok, sent, skipped, failed, waiting, errors }`.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const invoiceId = request.nextUrl.searchParams.get("invoiceId") ?? undefined;
    const result = await runReviewAsks(new Date(), { onlyInvoiceId: invoiceId });
    console.log(
      `[cron/send-review-asks] done: ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed, ${result.waiting} waiting${result.stopped ? ` (stopped: ${result.stopped})` : ""}`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron/send-review-asks] Error:", error);
    return errorResponse("Internal error", 500);
  }
}
