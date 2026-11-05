// src/app/api/business/invoices/[id]/texted/route.ts
// Records an invoice or quote texted from the operator's phone as sent, as an email would:
// a draft becomes SENT and the first send stamps sentAt (starting the review-ask clock).

import { syncInvoicePdfToDriveById } from "@/features/business/lib/invoice-drive-sync";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/business/invoices/[id]/texted
 * @param request - Next.js request, admin-auth gated.
 * @param ctx - Route ctx with the invoice id.
 * @param ctx.params - Resolved Next.js dynamic route params.
 * @returns JSON `{ ok, sentAt }` or an error.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { status: true, sentAt: true },
  });
  if (!invoice) {
    return errorResponse("Invoice not found", 404);
  }
  if (invoice.status === "VOIDED") {
    return errorResponse("Cannot text a voided invoice; issue a new one instead.", 409);
  }

  // Same rules as the email: status only moves DRAFT > SENT, sentAt stamps once.
  const updated = await prisma.invoice.update({
    where: { id },
    data: {
      ...(invoice.status === "DRAFT" ? { status: "SENT" } : {}),
      ...(invoice.sentAt ? {} : { sentAt: new Date() }),
    },
    select: { sentAt: true, updatedAt: true },
  });

  // The operator's Drive copy picks up the SENT status, as on an emailed send.
  await syncInvoicePdfToDriveById(id, "[invoice-texted]");

  // updatedAt covers SENT rows that predate the sentAt column.
  return NextResponse.json({
    ok: true,
    sentAt: (updated.sentAt ?? updated.updatedAt).toISOString(),
  });
}
