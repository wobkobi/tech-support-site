// src/app/api/business/invoices/[id]/void/route.ts
// Voids an invoice (idempotent), releases its promo redemption and re-renders the
// VOID-stamped PDF. Email and Drive sync are best-effort; the status change never rolls back.

import { syncInvoicePdfToDrive } from "@/features/business/lib/invoice-drive-sync";
import {
  parseInvoiceEmailOverrides,
  toInvoiceEmailPayload,
} from "@/features/business/lib/invoice-email-request";
import { generateInvoicePdf, serialiseInvoice } from "@/features/business/lib/invoice-pdf";
import { releaseInvoiceRedemptions } from "@/features/business/lib/promo-redemption";
import { sendVoidNotification } from "@/features/reviews/lib/email-invoice";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/business/invoices/[id]/void
 * Void the invoice and optionally notify the client.
 * Body: { sendNotification: boolean, greetingName?, customBody? }
 * @param request - Next.js request (admin-auth gated).
 * @param ctx - Route ctx with the invoice id.
 * @param ctx.params - Resolved Next.js dynamic route params.
 * @returns JSON `{ ok, voidedAt, notified, incomeEntryCount }` or an error.
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

  const { greetingName, customBody, sendNotification } = await parseInvoiceEmailOverrides(request);

  // Already voided: keep the original voidedAt and just re-send / re-sync.
  const alreadyVoided = invoice.status === "VOIDED";
  const voidedAt = alreadyVoided ? invoice.voidedAt : new Date();
  if (!alreadyVoided) {
    // Only the request that flips the status carries on, so two tabs send one notice.
    const claimed = await prisma.invoice.updateMany({
      where: { id, status: { not: "VOIDED" } },
      data: { status: "VOIDED", voidedAt },
    });
    if (claimed.count === 0) {
      return errorResponse("This invoice was just voided from another tab. Reload to see it.", 409);
    }
  }
  const updated = alreadyVoided ? invoice : { ...invoice, status: "VOIDED" as const, voidedAt };
  // A voided invoice gave no discount, so its promo use stops counting.
  await releaseInvoiceRedemptions(id);

  // Lets the UI warn that linked income needs manual reversal.
  const incomeEntryCount = await prisma.incomeEntry.count({ where: { invoiceId: id } });

  // A PDF failure still voids; email and Drive are skipped and notified stays false.
  let pdfBytes: Buffer | null = null;
  try {
    pdfBytes = await generateInvoicePdf(serialiseInvoice(updated));
  } catch (err) {
    console.error(`[invoice-void] PDF generation failed for ${updated.number}:`, err);
  }

  let notified = false;
  if (sendNotification && pdfBytes && updated.clientEmail) {
    notified = await sendVoidNotification({
      invoice: await toInvoiceEmailPayload(updated),
      pdfBytes,
      greetingName,
      customBody,
    });
  }

  // Sync the stamped PDF to Drive so the original Drive link now shows VOID.
  if (pdfBytes) await syncInvoicePdfToDrive(updated, pdfBytes, "[invoice-void]");

  return NextResponse.json({
    ok: true,
    voidedAt: voidedAt ? voidedAt.toISOString() : null,
    notified,
    incomeEntryCount,
    alreadyVoided,
  });
}
