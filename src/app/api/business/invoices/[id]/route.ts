import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { calcInvoiceTotals } from "@/features/business/lib/business";
import { extractYearCode, generateInvoicePdf } from "@/features/business/lib/invoice-pdf";
import { uploadInvoicePdf } from "@/features/business/lib/google-drive";

/**
 * Re-uploads the invoice's PDF to Drive (replacing the existing file in place when
 * `driveFileId` is set, otherwise creating a fresh one) and persists any new IDs
 * on the invoice record. Failures are logged but never thrown — Drive is a
 * non-critical archive sync.
 * @param invoiceId - Invoice DB id (used for the post-upload patch).
 */
async function syncInvoicePdfToDrive(invoiceId: string): Promise<void> {
  try {
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) return;
    const pdfBytes = await generateInvoicePdf({
      ...inv,
      issueDate: inv.issueDate.toISOString(),
      dueDate: inv.dueDate.toISOString(),
      createdAt: inv.createdAt.toISOString(),
      updatedAt: inv.updatedAt.toISOString(),
    });
    const yearCode = extractYearCode(inv.number);
    const drive = await uploadInvoicePdf(
      pdfBytes,
      inv.number,
      yearCode,
      inv.driveFileId ?? undefined,
    );
    if (drive.fileId !== inv.driveFileId || drive.webUrl !== inv.driveWebUrl) {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { driveFileId: drive.fileId, driveWebUrl: drive.webUrl },
      });
    }
  } catch (err) {
    console.error(`[invoice-patch] Drive sync failed:`, err);
  }
}

/**
 * GET /api/business/invoices/[id] - Returns a single invoice by ID.
 * @param request - Incoming Next.js request
 * @param root0 - Route context
 * @param root0.params - Route params containing the invoice ID
 * @returns JSON with the invoice or a 404 error
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, invoice });
}

/**
 * PATCH /api/business/invoices/[id] - Updates an invoice.
 * Accepts a status-only patch or a full invoice update.
 * @param request - Incoming Next.js request
 * @param root0 - Route context
 * @param root0.params - Route params containing the invoice ID
 * @returns JSON with the updated invoice
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  // Full update
  if (body.clientName !== undefined || body.lineItems !== undefined) {
    const { clientName, clientEmail, issueDate, dueDate, lineItems, gst, notes, status } = body;
    const { subtotal, gstAmount, total } = calcInvoiceTotals(lineItems ?? [], gst ?? false);
    const invoice = await prisma.invoice.update({
      where: { id },
      data: {
        ...(clientName !== undefined && { clientName }),
        ...(clientEmail !== undefined && { clientEmail }),
        ...(issueDate !== undefined && { issueDate: new Date(issueDate) }),
        ...(dueDate !== undefined && { dueDate: new Date(dueDate) }),
        ...(lineItems !== undefined && { lineItems, subtotal, gstAmount, total }),
        ...(gst !== undefined && { gst }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(status !== undefined && { status }),
      },
    });
    // Any field change should be reflected in the Drive archive copy.
    await syncInvoicePdfToDrive(id);
    return NextResponse.json({ ok: true, invoice });
  }

  // Status-only patch
  const { status } = body;
  if (!["DRAFT", "SENT", "PAID"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const invoice = await prisma.invoice.update({ where: { id }, data: { status } });
  // Status changes (Mark as paid, etc.) should be reflected in the Drive archive copy.
  await syncInvoicePdfToDrive(id);
  return NextResponse.json({ ok: true, invoice });
}

/**
 * DELETE /api/business/invoices/[id] - Deletes an invoice by ID.
 * @param request - Incoming Next.js request
 * @param root0 - Route context
 * @param root0.params - Route params containing the invoice ID
 * @returns JSON confirmation
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await prisma.invoice.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
