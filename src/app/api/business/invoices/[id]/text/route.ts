// src/app/api/business/invoices/[id]/text/route.ts
// Writes the text-message version of an invoice or quote for the operator to send from
// their phone: the message (with the customer link, made on first use) and the contact's
// mobile. Sending happens on the phone; the texted route records it.

import { toInvoiceEmailPayload } from "@/features/business/lib/invoice-email-request";
import { isInvoiceOverdue } from "@/features/business/lib/invoice-status";
import { buildInvoiceText } from "@/features/reviews/lib/email-invoice";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/business/invoices/[id]/text
 * @param request - Next.js request, admin-auth gated.
 * @param ctx - Route ctx with the invoice id.
 * @param ctx.params - Resolved Next.js dynamic route params.
 * @returns JSON `{ ok, text, phone }` (phone null when neither the invoice nor its contact
 *   has one) or an error.
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
  if (invoice.status === "VOIDED") {
    return errorResponse("Cannot text a voided invoice; issue a new one instead.", 409);
  }

  const payload = await toInvoiceEmailPayload(invoice);
  if (!payload.viewUrl) {
    return errorResponse("Couldn't make the link to the PDF. Try again.", 500);
  }
  // The invoice's own mobile first, else the linked contact's. Invoices keep contactId
  // after a soft delete, so skip deleted contacts.
  const contact =
    !invoice.clientPhone && invoice.contactId
      ? await prisma.contact.findFirst({
          where: { id: invoice.contactId, deletedAt: null },
          select: { phone: true },
        })
      : null;
  const state = invoice.status === "PAID" ? "paid" : isInvoiceOverdue(invoice) ? "overdue" : "open";

  return NextResponse.json({
    ok: true,
    text: buildInvoiceText(payload, state, await getIdentity()),
    phone: invoice.clientPhone || contact?.phone?.trim() || null,
  });
}
