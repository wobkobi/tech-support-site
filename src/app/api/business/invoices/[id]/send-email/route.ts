// src/app/api/business/invoices/[id]/send-email/route.ts
// Admin endpoint that emails an invoice to the client. POST re-generates the PDF, sends
// it, flips a draft to SENT, stamps sentAt (which starts the review-ask clock), cancels
// the review ask when the operator unticked it, and re-syncs the PDF to Drive.

import { syncInvoicePdfToDrive } from "@/features/business/lib/invoice-drive-sync";
import {
  parseInvoiceEmailOverrides,
  toInvoiceEmailPayload,
} from "@/features/business/lib/invoice-email-request";
import { generateInvoicePdf, serialiseInvoice } from "@/features/business/lib/invoice-pdf";
import { sendInvoiceEmail } from "@/features/reviews/lib/email-invoice";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/business/invoices/[id]/send-email
 * Re-generates the invoice PDF, emails it to the client, and flips a draft to SENT.
 * @param request - Next.js request (admin-auth gated).
 * @param ctx - Route ctx with the invoice id.
 * @param ctx.params - Resolved Next.js dynamic route params.
 * @returns JSON with `{ ok, sentAt }` or an error.
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  // Load the invoice
  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return errorResponse("Invoice not found", 404);
  }
  if (!invoice.clientEmail) {
    return errorResponse("Invoice has no client email", 400);
  }
  // A voided invoice is cancelled; emailing its PDF (and flipping it back to
  // SENT) would resurrect a terminal record. Issue a fresh invoice instead.
  if (invoice.status === "VOIDED") {
    return errorResponse("Cannot email a voided invoice; issue a new one instead.", 409);
  }

  // Optional operator overrides (match the preview): greetingName targets a
  // person inside a company invoice, customBody replaces the intro paragraph,
  // reviewAsk false cancels the automatic review ask.
  const { greetingName, customBody, reviewAsk } = await parseInvoiceEmailOverrides(request);

  // Generate the invoice PDF
  let pdfBytes: Buffer;
  try {
    pdfBytes = await generateInvoicePdf(serialiseInvoice(invoice));
  } catch (err) {
    console.error(`[invoice-email] PDF generation failed for ${invoice.number}:`, err);
    return errorResponse("PDF generation failed", 500);
  }

  // Send the email
  const ok = await sendInvoiceEmail({
    invoice: await toInvoiceEmailPayload(invoice),
    pdfBytes,
    greetingName,
    customBody,
  });
  if (!ok) {
    return errorResponse("Email send failed", 502);
  }

  // Status only ever moves DRAFT > SENT; a re-sent SENT or PAID invoice (a receipt copy)
  // must not regress. sentAt is stamped on the first email whatever the status, so a
  // receipt for an invoice paid on the day still starts the review-ask clock. The
  // unticked box only cancels an ask that is still open on a real invoice.
  const now = new Date();
  const cancelAsk = reviewAsk === false && !invoice.isQuote && !invoice.reviewAskOutcome;
  const updated = await prisma.invoice.update({
    where: { id },
    data: {
      ...(invoice.status === "DRAFT" ? { status: "SENT" } : {}),
      ...(invoice.sentAt ? {} : { sentAt: now }),
      ...(cancelAsk
        ? { reviewAskOutcome: "cancelled", reviewAskNote: "unticked", reviewAskDecidedAt: now }
        : {}),
    },
    select: { updatedAt: true, sentAt: true },
  });

  // Sync the freshly-sent PDF to Drive so the archive matches what the client
  // received. Best-effort - the email is the critical path.
  await syncInvoicePdfToDrive(invoice, pdfBytes, "[invoice-email]");

  // Return the real sentAt (falling back to updatedAt for legacy SENT rows that
  // predate the sentAt column).
  return NextResponse.json({
    ok: true,
    sentAt: (updated.sentAt ?? updated.updatedAt).toISOString(),
  });
}
