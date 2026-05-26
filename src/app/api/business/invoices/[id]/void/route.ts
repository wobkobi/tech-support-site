// src/app/api/business/invoices/[id]/void/route.ts
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { sendVoidNotification } from "@/features/reviews/lib/email";
import { extractYearCode, generateInvoicePdf } from "@/features/business/lib/invoice-pdf";
import { uploadInvoicePdf } from "@/features/business/lib/google-drive";

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
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

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
  // void still succeeds - we just can't email or sync. Surface notified:false
  // to the caller so they can advise the operator to email manually.
  let pdfBytes: Buffer | null = null;
  try {
    pdfBytes = await generateInvoicePdf({
      ...updated,
      issueDate: updated.issueDate.toISOString(),
      dueDate: updated.dueDate.toISOString(),
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error(`[invoice-void] PDF generation failed for ${updated.number}:`, err);
  }

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
  // Best-effort - log on failure, don't fail the request.
  if (pdfBytes) {
    try {
      const yearCode = extractYearCode(updated.number);
      const drive = await uploadInvoicePdf(
        pdfBytes,
        updated.number,
        yearCode,
        updated.driveFileId ?? undefined,
      );
      if (drive.fileId !== updated.driveFileId || drive.webUrl !== updated.driveWebUrl) {
        await prisma.invoice.update({
          where: { id },
          data: { driveFileId: drive.fileId, driveWebUrl: drive.webUrl },
        });
      }
    } catch (err) {
      console.error(`[invoice-void] Drive sync failed for ${updated.number}:`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    voidedAt: voidedAt ? voidedAt.toISOString() : null,
    notified,
    incomeEntryCount,
    alreadyVoided,
  });
}
