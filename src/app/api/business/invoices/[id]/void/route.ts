// src/app/api/business/invoices/[id]/void/route.ts
/**
 * @description Admin endpoint that voids an invoice. POST flips status to VOIDED
 * and stamps voidedAt (idempotent for already-voided invoices, preserving the
 * original timestamp), regenerates the PDF with the VOID watermark, optionally
 * emails the client a void notice, counts linked income entries for the operator
 * warning, and re-syncs the stamped PDF to Drive. Email and Drive sync are
 * best-effort; the status change is authoritative and never rolls back.
 */

import { syncInvoicePdfToDrive } from "@/features/business/lib/invoice-drive-sync";
import { generateInvoicePdf, serializeInvoice } from "@/features/business/lib/invoice-pdf";
import { sendVoidNotification } from "@/features/reviews/lib/email";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/business/invoices/[id]/void
 * Flips status to VOIDED, stamps voidedAt, regenerates the PDF with the VOID
 * watermark. Optional client email + Drive sync are best-effort; the status
 * change is authoritative and never rolls back on those failing.
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

  // Load the invoice
  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return errorResponse("Invoice not found", 404);
  }

  // Parse optional overrides
  const body = (await request.json().catch(() => ({}))) as {
    sendNotification?: unknown;
    greetingName?: unknown;
    customBody?: unknown;
  };
  const sendNotification = body.sendNotification === true;
  const greetingName = typeof body.greetingName === "string" ? body.greetingName : undefined;
  const customBody = typeof body.customBody === "string" ? body.customBody : undefined;

  // Idempotent for already-voided invoices: skip the status flip + voidedAt
  // stamp and just (re)send the notification + (re)sync Drive. Useful when
  // the first send hit a Resend error or the operator wants to send a follow-
  // up reminder. The original voidedAt timestamp is preserved.
  const alreadyVoided = invoice.status === "VOIDED";
  const voidedAt = alreadyVoided ? invoice.voidedAt : new Date();
  const updated = alreadyVoided
    ? invoice
    : await prisma.invoice.update({
        where: { id },
        data: { status: "VOIDED", voidedAt: voidedAt ?? new Date() },
      });

  // Count linked income entries so the UI can warn the operator about manual
  // reversal. PAID > VOIDED is the common case; DRAFT/SENT > VOIDED would
  // typically have zero linked entries.
  const incomeEntryCount = await prisma.incomeEntry.count({ where: { invoiceId: id } });

  // Generate the VOIDED-stamped PDF from the updated row. If this fails, the
  // void still succeeds - the email and Drive sync are skipped. Surface
  // notified:false to the caller so the operator can be advised to email manually.
  let pdfBytes: Buffer | null = null;
  try {
    pdfBytes = await generateInvoicePdf(serializeInvoice(updated));
  } catch (err) {
    console.error(`[invoice-void] PDF generation failed for ${updated.number}:`, err);
  }

  // Send the void notification
  let notified = false;
  if (sendNotification && pdfBytes && updated.clientEmail) {
    notified = await sendVoidNotification({
      invoice: {
        number: updated.number,
        clientName: updated.clientName,
        clientEmail: updated.clientEmail,
        issueDate: updated.issueDate,
        dueDate: updated.dueDate,
        total: updated.total,
        driveWebUrl: updated.driveWebUrl,
      },
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
