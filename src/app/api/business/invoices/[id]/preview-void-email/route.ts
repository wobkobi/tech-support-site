// src/app/api/business/invoices/[id]/preview-void-email/route.ts
// Renders the void-notification email for review without sending it.

import {
  parseInvoiceEmailOverrides,
  toInvoiceEmailPayload,
} from "@/features/business/lib/invoice-email-request";
import { buildVoidEmail } from "@/features/reviews/lib/email-invoice";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/business/invoices/[id]/preview-void-email
 * Rendered subject + HTML for the void notice. Sends nothing.
 * @param request - Next.js request (admin-auth gated).
 * @param ctx - Route ctx with the invoice id.
 * @param ctx.params - Resolved Next.js dynamic route params.
 * @returns JSON with `{ ok, subject, html, to }` or an error.
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

  const { greetingName, customBody } = await parseInvoiceEmailOverrides(request);

  const payload = await toInvoiceEmailPayload(invoice);
  const { subject, html } = await buildVoidEmail({
    invoice: payload,
    greetingName,
    customBody,
  });

  return NextResponse.json({
    ok: true,
    subject,
    html,
    to: invoice.clientEmail,
    // Who a blank greeting field greets, so the modal can say so.
    defaultGreeting: payload.defaultGreeting,
  });
}
