// src/app/api/business/invoices/[id]/route.ts
/**
 * @description Admin endpoint for a single invoice. GET returns it. PATCH applies
 * a status-only change, a contactId backfill, or a full field update, enforcing transition rules
 * via {@link validateTransition} (VOIDED is terminal) and recomputing totals on
 * line-item changes. DELETE removes DRAFT invoices only; SENT/PAID/VOIDED are
 * audit-protected. Field-changing paths re-sync the PDF to Drive.
 */

import { calcInvoiceTotals, isValidLineItem } from "@/features/business/lib/business";
import { syncInvoicePdfToDriveById } from "@/features/business/lib/invoice-drive-sync";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { InvoiceStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/** The lifecycle-timestamp patch {@link statusDataFor} returns for a status change. */
interface StatusPatch {
  status: InvoiceStatus;
  voidedAt: Date | null;
  sentAt?: Date;
  paidAt?: Date | null;
  paymentMethod?: null;
  paymentReference?: null;
}

/**
 * Builds the patch payload for a status change: stamps/clears the lifecycle
 * timestamps to match the target status. voidedAt stamps on entering VOIDED and
 * clears otherwise (preserved exactly). sentAt stamps the first time the invoice
 * reaches SENT. paidAt stamps the first time it reaches PAID; leaving PAID clears
 * the whole payment record (paidAt + method + reference) so a re-opened invoice
 * carries no stale payment. All status-flipping paths funnel through here.
 * @param next - Target InvoiceStatus.
 * @param current - The invoice's current lifecycle timestamps.
 * @param current.sentAt - Current sentAt (null until first SENT); keeps an existing stamp.
 * @param current.paidAt - Current paidAt (null until first PAID); keeps an existing stamp.
 * @returns Partial update payload to splat into prisma.invoice.update data.
 */
function statusDataFor(
  next: InvoiceStatus,
  current: { sentAt: Date | null; paidAt: Date | null },
): StatusPatch {
  const now = new Date();
  const data: StatusPatch = { status: next, voidedAt: next === "VOIDED" ? now : null };
  if (next === "SENT" && current.sentAt === null) data.sentAt = now;
  if (next === "PAID") {
    if (current.paidAt === null) data.paidAt = now;
  } else {
    data.paidAt = null;
    data.paymentMethod = null;
    data.paymentReference = null;
  }
  return data;
}

/**
 * Returns null when the transition is allowed, or an error message when it's
 * not. VOIDED is terminal - once a tax invoice is cancelled the audit trail
 * must remain (NZ IRD record-retention); issue a fresh invoice instead.
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
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) return errorResponse("Not found", 404);
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
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;
  const body = await request.json();

  // Load the current row to enforce transition rules + the
  // VOIDED-is-immutable invariant. One extra query in exchange for a much
  // stronger audit guarantee.
  const current = await prisma.invoice.findUnique({
    where: { id },
    select: {
      status: true,
      promoDiscount: true,
      unsuccessfulDiscount: true,
      sentAt: true,
      paidAt: true,
      isQuote: true,
    },
  });
  if (!current) {
    return errorResponse("Invoice not found", 404);
  }

  // Full update: the body carries invoice fields, not just a status. Includes
  // notes-only edits - clientEmail/issueDate/dueDate/notes previously fell
  // through to the status branch and 400'd on the missing status.
  if (
    body.clientName !== undefined ||
    body.clientEmail !== undefined ||
    body.issueDate !== undefined ||
    body.dueDate !== undefined ||
    body.lineItems !== undefined ||
    body.notes !== undefined
  ) {
    if (current.status === "VOIDED") {
      return NextResponse.json(
        { error: "Voided invoices are immutable; issue a new invoice instead." },
        { status: 409 },
      );
    }
    // Only DRAFT invoices can have their content edited; SENT/PAID are audit-
    // locked (void + reissue instead). Notes stay editable on any status for IRD
    // audit annotations, so they are excluded from this guard.
    const editsContent =
      body.clientName !== undefined ||
      body.clientEmail !== undefined ||
      body.issueDate !== undefined ||
      body.dueDate !== undefined ||
      body.lineItems !== undefined;
    if (current.status !== "DRAFT" && editsContent) {
      return NextResponse.json(
        { error: "Only draft invoices can be edited; void and reissue." },
        { status: 409 },
      );
    }
    const { clientName, clientEmail, issueDate, dueDate, lineItems, notes, status } = body;
    // Validate replacement line items before they reach calcInvoiceTotals /
    // prisma.update - a non-finite numeric would persist NaN totals.
    if (
      lineItems !== undefined &&
      (!Array.isArray(lineItems) || !lineItems.every(isValidLineItem))
    ) {
      return errorResponse("Invalid line item", 400);
    }
    if (status !== undefined) {
      const err = validateTransition(current.status, status as InvoiceStatus);
      if (err) return errorResponse(err, 409);
    }
    // GST mode is driven by the live pricing settings (gstRegistered); the
    // request body does not carry gst. gstAmount is non-zero once that flag
    // is on, stays 0 today.
    const { GST_REGISTERED } = await getPolicy();
    // Preserve the invoice's stored discounts when recomputing on a line-item
    // edit; recomputing with 0 would silently strip the promo / unsuccessful
    // discount from the total charged.
    const preservedDiscount = (current.promoDiscount ?? 0) + (current.unsuccessfulDiscount ?? 0);
    const { subtotal, gstAmount, total } = calcInvoiceTotals(
      lineItems ?? [],
      preservedDiscount,
      GST_REGISTERED,
    );
    const statusPatch = status !== undefined ? statusDataFor(status as InvoiceStatus, current) : {};
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
    await syncInvoicePdfToDriveById(id, "[invoice-patch]");
    return NextResponse.json({ ok: true, invoice });
  }

  // contactId-only backfill: the calculator links a freshly-saved invoice to a
  // contact after the invoice is created. Handle it before the status branch so
  // a contactId-only PATCH is not rejected as an invalid status.
  if (body.contactId !== undefined && body.status === undefined) {
    const contactId =
      typeof body.contactId === "string" && /^[a-f0-9]{24}$/i.test(body.contactId)
        ? body.contactId
        : null;
    const invoice = await prisma.invoice.update({ where: { id }, data: { contactId } });
    return NextResponse.json({ ok: true, invoice });
  }

  // Status-only patch (the list-view dropdown). Intentionally does NOT
  // trigger the void notification flow (that lives at /void); statusDataFor
  // stamps/clears voidedAt so the detail page label stays in sync.
  const { status } = body;
  if (!["DRAFT", "SENT", "PAID", "VOIDED"].includes(status)) {
    return errorResponse("Invalid status", 400);
  }
  // Quotes can't be marked PAID - conversion is the only path to a payable
  // invoice (the /pay route carries the same guard).
  if (current.isQuote && status === "PAID") {
    return errorResponse("Convert the quote to an invoice before recording payment.", 409);
  }
  const transitionErr = validateTransition(current.status, status as InvoiceStatus);
  if (transitionErr) {
    return errorResponse(transitionErr, 409);
  }
  const invoice = await prisma.invoice.update({
    where: { id },
    data: statusDataFor(status as InvoiceStatus, current),
  });
  // Status changes (Mark as paid, etc.) should be reflected in the Drive archive copy.
  await syncInvoicePdfToDriveById(id, "[invoice-patch]");
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
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;
  // Only DRAFT invoices are deletable. SENT/PAID/VOIDED are part of the audit
  // trail (and for VOIDED in particular, the IRD record-retention rule) so
  // they can never be removed - the UI hides the delete button for those
  // statuses, but the rule is enforced server-side too in case of crafted requests.
  const existing = await prisma.invoice.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!existing) {
    return errorResponse("Invoice not found", 404);
  }
  if (existing.status !== "DRAFT") {
    return errorResponse(
      "Only DRAFT invoices can be deleted. Void the invoice instead to preserve the audit trail.",
      409,
    );
  }
  await prisma.invoice.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
