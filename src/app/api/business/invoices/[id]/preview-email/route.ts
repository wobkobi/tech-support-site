// src/app/api/business/invoices/[id]/preview-email/route.ts
/**
 * @description Admin endpoint that renders the invoice email for review without
 * sending it. POST builds the subject + HTML body, applying optional operator
 * overrides (greetingName, customBody, includeReview), and decides whether to
 * include the review link based on the override or the eligibility check.
 */

import { getInvoiceReviewEligibility } from "@/features/business/lib/contact-review-token";
import {
  parseInvoiceEmailOverrides,
  resolveReviewInclusion,
  toInvoiceEmailPayload,
} from "@/features/business/lib/invoice-email-request";
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
  const {
    greetingName,
    customBody,
    includeReview: includeReviewOverride,
  } = await parseInvoiceEmailOverrides(request);

  const siteUrl = getSiteUrl();
  const eligibility = await getInvoiceReviewEligibility({
    contactId: invoice.contactId,
    clientEmail: invoice.clientEmail,
    siteUrl,
  });

  // Only the URL is needed here: the client re-derives the checkbox state from
  // `eligibility` in the response.
  const { reviewUrl } = resolveReviewInclusion(invoice, eligibility, includeReviewOverride);

  const { subject, html } = await buildInvoiceEmail({
    invoice: toInvoiceEmailPayload(invoice),
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
