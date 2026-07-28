// src/app/api/business/invoices/[id]/preview-email/route.ts
/**
 * @description Admin endpoint that renders the invoice email for review without
 * sending it. POST builds the subject + HTML body, applying optional operator
 * overrides (greetingName, customBody, includeReview), and decides whether to
 * include the review link based on the override or the eligibility check.
 */

import { getInvoiceReviewEligibility } from "@/features/business/lib/contact-review-token";
import { buildInvoiceEmail } from "@/features/reviews/lib/email";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSiteUrl } from "@/shared/lib/site-url";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/business/invoices/[id]/preview-email
 * Returns the rendered subject + HTML body for the invoice email so the
 * operator can review it in a modal before sending. No email is sent.
 * @param request - Next.js request (admin-auth gated).
 * @param ctx - Route ctx with the invoice id.
 * @param ctx.params - Resolved Next.js dynamic route params.
 * @returns JSON with `{ ok, subject, html }` or an error.
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

  // Optional operator overrides: greetingName targets a person inside a
  // company invoice, customBody replaces the intro paragraph, includeReview
  // forces the review link on/off (defaults to the eligibility check).
  const body = (await request.json().catch(() => ({}))) as {
    greetingName?: unknown;
    customBody?: unknown;
    includeReview?: unknown;
  };
  const greetingName = typeof body.greetingName === "string" ? body.greetingName : undefined;
  const customBody = typeof body.customBody === "string" ? body.customBody : undefined;
  const includeReviewOverride =
    typeof body.includeReview === "boolean" ? body.includeReview : undefined;

  const siteUrl = getSiteUrl();
  const eligibility = await getInvoiceReviewEligibility({
    contactId: invoice.contactId,
    clientEmail: invoice.clientEmail,
    siteUrl,
  });

  // Unchecking the box drops the review line from the preview, but ticking it
  // cannot force one on: the send route ignores an explicit true when
  // eligibility says no, so the preview has to apply the same `&& canSend`
  // guard or it renders a link the real email would strip.
  // Quotes never carry a review ask, matching the send route.
  const includeReview =
    !invoice.isQuote && (includeReviewOverride ?? eligibility.canSend) && eligibility.canSend;
  const reviewUrl =
    includeReview && "reviewUrl" in eligibility ? (eligibility.reviewUrl ?? null) : null;

  const { subject, html } = await buildInvoiceEmail({
    invoice: {
      number: invoice.number,
      clientName: invoice.clientName,
      clientEmail: invoice.clientEmail,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      total: invoice.total,
      driveWebUrl: invoice.driveWebUrl,
      isQuote: invoice.isQuote,
      quoteValidUntil: invoice.quoteValidUntil,
    },
    reviewUrl,
    greetingName,
    customBody,
  });

  return NextResponse.json({
    ok: true,
    subject,
    html,
    to: invoice.clientEmail,
    eligibility,
  });
}
