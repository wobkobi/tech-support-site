// src/app/api/business/invoices/[id]/route.ts
// Admin single invoice. PATCH handles status-only, contactId backfill or full updates
// (VOIDED is terminal); DELETE removes DRAFTs only.

import {
  calcInvoiceTotals,
  isValidLineItem,
  withSplitLineTotals,
} from "@/features/business/lib/business";
import {
  parseAlreadyPaid,
  syncAlreadyPaidIncome,
} from "@/features/business/lib/invoice-already-paid";
import { syncInvoicePdfToDriveById } from "@/features/business/lib/invoice-drive-sync";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { releaseInvoiceRedemptions } from "@/features/business/lib/promo-redemption";
import { parseAmount, parseDate, parseObjectId } from "@/features/business/lib/validation";
import type { LineItem } from "@/features/business/types/business";
import { attachEmailIfMissing } from "@/features/contacts/lib/find-or-create";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { normaliseEmail } from "@/shared/lib/normalise-email";
import { prisma } from "@/shared/lib/prisma";
import { InvoiceStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

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
 * Lifecycle timestamps for a status change. sentAt/paidAt stamp on first arrival;
 * leaving PAID clears the whole payment record so a re-opened invoice carries none.
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
 * Narrow an untrusted status, so a bad value is a 400 rather than a Prisma 500.
 * @param value - Raw status from a request body.
 * @returns True when the value is one of the invoice statuses.
 */
function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === "string" && Object.values(InvoiceStatus).includes(value as InvoiceStatus);
}

/**
 * Check a status transition. VOIDED is terminal (NZ IRD record-retention).
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

  // Current row, for transition rules and the VOIDED-is-immutable invariant.
  const current = await prisma.invoice.findUnique({
    where: { id },
    select: {
      status: true,
      promoDiscount: true,
      promoId: true,
      unsuccessfulDiscount: true,
      sentAt: true,
      paidAt: true,
      isQuote: true,
    },
  });
  if (!current) {
    return errorResponse("Invoice not found", 404);
  }

  // Full update, including notes-only edits, which the status branch would 400.
  if (
    body.clientName !== undefined ||
    body.clientEmail !== undefined ||
    body.issueDate !== undefined ||
    body.dueDate !== undefined ||
    body.lineItems !== undefined ||
    body.alreadyPaid !== undefined ||
    body.notes !== undefined
  ) {
    if (current.status === "VOIDED") {
      return NextResponse.json(
        { error: "Voided invoices are immutable; issue a new invoice instead." },
        { status: 409 },
      );
    }
    // Only DRAFT content is editable; notes stay editable on any status for audit annotations.
    const editsContent =
      body.clientName !== undefined ||
      body.clientEmail !== undefined ||
      body.issueDate !== undefined ||
      body.dueDate !== undefined ||
      body.lineItems !== undefined ||
      body.alreadyPaid !== undefined;
    if (current.status !== "DRAFT" && editsContent) {
      return NextResponse.json(
        { error: "Only draft invoices can be edited; void and reissue." },
        { status: 409 },
      );
    }
    const { clientName, clientEmail, issueDate, dueDate, lineItems, notes, status } = body;
    // A non-finite numeric would persist NaN totals.
    if (
      lineItems !== undefined &&
      (!Array.isArray(lineItems) || !lineItems.every(isValidLineItem))
    ) {
      return errorResponse("Invalid line item", 400);
    }
    // Re-derive line totals so they always add up to the subtotal.
    const lines =
      lineItems !== undefined ? withSplitLineTotals(lineItems as LineItem[]) : undefined;
    // A cleared date input submits "", which must 400 here or Prisma 500s.
    const issueDateValue = issueDate !== undefined ? parseDate(issueDate) : undefined;
    const dueDateValue = dueDate !== undefined ? parseDate(dueDate) : undefined;
    if (issueDateValue === null || dueDateValue === null) {
      return errorResponse("Enter a valid issue date and due date", 400);
    }
    // alreadyPaid and alreadyPaidMethod travel together; a null amount clears both.
    const prepaid =
      body.alreadyPaid !== undefined
        ? current.isQuote
          ? { ok: true as const, amount: null, method: null }
          : parseAlreadyPaid(body.alreadyPaid, body.alreadyPaidMethod)
        : undefined;
    if (prepaid && !prepaid.ok) return errorResponse(prepaid.error, 400);
    // A re-priced discount only rides with replacement line items; absent keeps the stored one.
    const repricesUnsuccessful = lineItems !== undefined && body.unsuccessfulDiscount !== undefined;
    let unsuccessfulDiscount = current.unsuccessfulDiscount ?? 0;
    if (repricesUnsuccessful) {
      const parsed = parseAmount(body.unsuccessfulDiscount ?? 0);
      if (parsed === null) return errorResponse("Invalid unsuccessful-work discount", 400);
      unsuccessfulDiscount = parsed;
    }
    // Only an invoice raised with a promo can have it re-priced; this never adds one.
    const repricesPromo =
      lineItems !== undefined && body.promoDiscount !== undefined && current.promoId != null;
    let promoDiscount = current.promoDiscount ?? 0;
    if (repricesPromo) {
      const parsed = parseAmount(body.promoDiscount ?? 0);
      if (parsed === null) return errorResponse("Invalid promo discount", 400);
      promoDiscount = parsed;
    }
    if (status !== undefined) {
      if (!isInvoiceStatus(status)) return errorResponse("Invalid status", 400);
      const err = validateTransition(current.status, status);
      if (err) return errorResponse(err, 409);
    }
    // GST mode comes from live settings, never the body.
    const { GST_REGISTERED } = await getPolicy();
    // Keep the discounts, or recomputing would silently strip them from the total.
    const { subtotal, gstAmount, total } = calcInvoiceTotals(
      lines ?? [],
      promoDiscount + unsuccessfulDiscount,
      GST_REGISTERED,
    );
    const statusPatch = isInvoiceStatus(status) ? statusDataFor(status, current) : {};
    const invoice = await prisma.invoice.update({
      where: { id },
      data: {
        ...(clientName !== undefined && { clientName }),
        ...(clientEmail !== undefined && { clientEmail: normaliseEmail(clientEmail) }),
        ...(issueDateValue && { issueDate: issueDateValue }),
        ...(dueDateValue && { dueDate: dueDateValue }),
        ...(lines !== undefined && {
          lineItems: lines,
          subtotal,
          gstAmount,
          total,
          gst: gstAmount > 0,
        }),
        ...(repricesUnsuccessful && {
          unsuccessful: unsuccessfulDiscount > 0,
          unsuccessfulDiscount: unsuccessfulDiscount > 0 ? unsuccessfulDiscount : null,
        }),
        // promoTitle and promoId stay, so the redemption still settles against the promo.
        ...(repricesPromo && { promoDiscount: promoDiscount > 0 ? promoDiscount : null }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(prepaid && { alreadyPaid: prepaid.amount, alreadyPaidMethod: prepaid.method }),
        ...statusPatch,
      },
    });
    // The settled redemption follows a re-priced discount; failure is only logged.
    if (repricesPromo && !current.isQuote && promoDiscount !== (current.promoDiscount ?? 0)) {
      await prisma.promoRedemption
        .updateMany({ where: { invoiceId: id }, data: { discountValue: promoDiscount } })
        .catch((err: unknown) => {
          console.error("[invoice-patch] Failed to update promo redemption value:", err);
        });
    }
    const incomeSheetWarning = prepaid ? (await syncAlreadyPaidIncome(id)).sheetSyncWarning : false;
    await syncInvoicePdfToDriveById(id, "[invoice-patch]");
    return NextResponse.json({ ok: true, invoice, incomeSheetWarning });
  }

  // contactId-only backfill from the calculator; before the status branch, which would 400 it.
  if (body.contactId !== undefined && body.status === undefined) {
    const contactId = parseObjectId(body.contactId);
    const invoice = await prisma.invoice.update({ where: { id }, data: { contactId } });
    // The redemption was settled before the contact existed; link it so per-customer
    // limits bind. Clearing the contact never unlinks it.
    if (contactId) {
      await attachEmailIfMissing(contactId, invoice.clientEmail);
      await prisma.promoRedemption
        .updateMany({ where: { invoiceId: id }, data: { contactId } })
        .catch((err: unknown) => {
          console.error("[invoice-patch] Failed to link promo redemption to contact:", err);
        });
    }
    return NextResponse.json({ ok: true, invoice });
  }

  // Status-only patch (list dropdown). Does NOT send the void notice - that's /void.
  const { status } = body;
  if (!isInvoiceStatus(status)) {
    return errorResponse("Invalid status", 400);
  }
  // Conversion is the only path to a payable invoice.
  if (current.isQuote && status === "PAID") {
    return errorResponse("Convert the quote to an invoice before recording payment.", 409);
  }
  const transitionErr = validateTransition(current.status, status);
  if (transitionErr) {
    return errorResponse(transitionErr, 409);
  }
  const invoice = await prisma.invoice.update({
    where: { id },
    data: statusDataFor(status, current),
  });
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
  // Only DRAFTs are deletable (audit trail); enforced here against crafted requests.
  const existing = await prisma.invoice.findUnique({
    where: { id },
    select: { status: true, alreadyPaidIncomeId: true },
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
  // A deleted draft is usually re-raised, so drop its already-paid entry to avoid a double count.
  let incomeSheetWarning = false;
  if (existing.alreadyPaidIncomeId) {
    await prisma.invoice.update({ where: { id }, data: { alreadyPaid: null } });
    incomeSheetWarning = (await syncAlreadyPaidIncome(id)).sheetSyncWarning;
  }
  // Likewise the redemption, or the re-raised invoice reads as a second use.
  await releaseInvoiceRedemptions(id);
  await prisma.invoice.delete({ where: { id } });
  return NextResponse.json({ ok: true, incomeSheetWarning });
}
