// src/app/api/business/invoices/[id]/preview-email/route.ts
// Renders the invoice email for review without sending, plus what the automatic
// review ask will do for the modal's checkbox.

import {
  parseInvoiceEmailOverrides,
  toInvoiceEmailPayload,
} from "@/features/business/lib/invoice-email-request";
import { buildInvoiceEmail } from "@/features/reviews/lib/email-invoice";
import { forecastInvoiceReviewAsk } from "@/features/reviews/lib/review-ask-queue.server";
import type { InvoiceReviewAskInfo } from "@/features/reviews/lib/review-ask-rules";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/business/invoices/[id]/preview-email
 * Rendered subject + HTML for the invoice email. Sends nothing.
 * @param request - Next.js request (admin-auth gated).
 * @param ctx - Route ctx with the invoice id.
 * @param ctx.params - Resolved Next.js dynamic route params.
 * @returns JSON with `{ ok, subject, html, to, reviewAsk, defaultGreeting }` or an error.
 *   `reviewAsk` is null for a quote, an already-decided ask, or asks switched off.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return errorResponse("Invoice not found", 404);
  }

  // greetingName targets a person at a company; customBody replaces the intro.
  const { greetingName, customBody } = await parseInvoiceEmailOverrides(request);

  const payload = await toInvoiceEmailPayload(invoice);
  const { subject, html } = await buildInvoiceEmail({
    invoice: payload,
    greetingName,
    customBody,
  });

  const { reviews } = await getSettings();
  let reviewAsk: InvoiceReviewAskInfo | null = null;
  if (!invoice.isQuote && !invoice.reviewAskOutcome && reviews.reviewAskEnabled) {
    reviewAsk = await forecastInvoiceReviewAsk(
      invoice,
      { delayDays: reviews.reviewAskDelayDays, gapDays: reviews.reviewAskGapDays },
      new Date(),
    );
  }

  return NextResponse.json({
    ok: true,
    subject,
    html,
    to: invoice.clientEmail,
    reviewAsk,
    // Who a blank greeting field greets, so the modal can say so.
    defaultGreeting: payload.defaultGreeting,
  });
}
