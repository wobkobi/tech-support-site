// src/app/api/business/invoices/[id]/preview-email/route.ts
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

  // includeReviewOverride wins when set (so unchecking the box updates the
  // preview to drop the review line). Default is whatever eligibility says.
  const includeReview = includeReviewOverride ?? eligibility.canSend;
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
