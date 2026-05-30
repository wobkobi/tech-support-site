import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { calcInvoiceTotals } from "@/features/business/lib/business";
import { extractYearCode, generateInvoicePdf } from "@/features/business/lib/invoice-pdf";
import { uploadInvoicePdf } from "@/features/business/lib/google-drive";
import type { InvoiceStatus } from "@prisma/client";

/**
 * Builds the patch payload for a status change. Stamps `voidedAt` when the
 * target is VOIDED so the audit trail records when the cancellation happened;
 * clears `voidedAt` when the target is any non-VOIDED status so an un-voided
 * invoice doesn't keep the stale "Voided 22 May" label on the detail page.
 * All paths that flip status (the void endpoint, the dropdown PATCH, the
 * full-update PATCH) funnel through here for consistency.
 * @param next - Target InvoiceStatus.
 * @returns Partial update payload to splat into prisma.invoice.update data.
 */
function statusDataFor(next: InvoiceStatus): { status: InvoiceStatus; voidedAt?: Date } {
  if (next === "VOIDED") return { status: next, voidedAt: new Date() };
  return { status: next };
}

/**
 * Returns null when the transition is allowed, or an error message when it's
 * not. VOIDED is terminal - once a tax invoice is cancelled the audit trail
 * must remain (NZ IRD record-retention). To "un-void", issue a fresh invoice;
 * use the resend-notification button if the cancellation email needs to go
 * out again.
 * @param current - The invoice's current status.
 * @param next - The requested target status.
 * @returns Error message, or null when allowed.
 */
function validateTransition(current: InvoiceStatus, next: InvoiceStatus): string | null {
  if (current === "VOIDED" && next !== "VOIDED") {
    return "Voided invoices are terminal; issue a new invoice instead of re-opening this one.";
  }
  return null;
}

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
  if (!(await isAdminRequest(request))) {
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
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  // Load the current row so we can enforce transition rules + the
  // VOIDED-is-immutable invariant. One extra query in exchange for a much
  // stronger audit guarantee.
  const current = await prisma.invoice.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!current) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // Full update
  if (body.clientName !== undefined || body.lineItems !== undefined) {
    if (current.status === "VOIDED") {
      return NextResponse.json(
        { error: "Voided invoices are immutable; issue a new invoice instead." },
        { status: 409 },
      );
    }
    const { clientName, clientEmail, issueDate, dueDate, lineItems, notes, status } = body;
    if (status !== undefined) {
      const err = validateTransition(current.status, status as InvoiceStatus);
      if (err) return NextResponse.json({ error: err }, { status: 409 });
    }
    // GST mode is driven by GST_REGISTERED in pricing-policy.ts; the request
    // body no longer carries gst. gstAmount may be non-zero in the future
    // when the flag flips, stays 0 today.
    const { subtotal, gstAmount, total } = calcInvoiceTotals(lineItems ?? []);
    const statusPatch = status !== undefined ? statusDataFor(status as InvoiceStatus) : {};
    const invoice = await prisma.invoice.update({
      where: { id },
      data: {
        ...(clientName !== undefined && { clientName }),
        ...(clientEmail !== undefined && { clientEmail }),
        ...(issueDate !== undefined && { issueDate: new Date(issueDate) }),
        ...(dueDate !== undefined && { dueDate: new Date(dueDate) }),
        ...(lineItems !== undefined && {
          lineItems,
          subtotal,
          gstAmount,
          total,
          gst: gstAmount > 0,
        }),
        ...(notes !== undefined && { notes: notes || null }),
        ...statusPatch,
      },
    });
    // Any field change should be reflected in the Drive archive copy.
    await syncInvoicePdfToDrive(id);
    return NextResponse.json({ ok: true, invoice });
  }

  // Status-only patch. The dropdown on the list view hits this path - it's a
  // low-friction admin override that intentionally does NOT trigger the void
  // notification flow (that lives at /void). voidedAt is stamped/cleared by
  // statusDataFor so the detail page label stays in sync if the operator
  // un-voids an invoice they cancelled by mistake.
  const { status } = body;
  if (!["DRAFT", "SENT", "PAID", "VOIDED"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const transitionErr = validateTransition(current.status, status as InvoiceStatus);
  if (transitionErr) {
    return NextResponse.json({ error: transitionErr }, { status: 409 });
  }
  const invoice = await prisma.invoice.update({
    where: { id },
    data: statusDataFor(status as InvoiceStatus),
  });
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
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  // Only DRAFT invoices are deletable. SENT/PAID/VOIDED are part of the audit
  // trail (and for VOIDED in particular, the IRD record-retention rule) so
  // they can never be removed - the UI hides the delete button for those
  // statuses, but we enforce it server-side too in case of crafted requests.
  const existing = await prisma.invoice.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (existing.status !== "DRAFT") {
    return NextResponse.json(
      {
        error:
          "Only DRAFT invoices can be deleted. Void the invoice instead to preserve the audit trail.",
      },
      { status: 409 },
    );
  }
  await prisma.invoice.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
