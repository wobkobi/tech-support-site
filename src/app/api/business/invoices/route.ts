// src/app/api/business/invoices/route.ts
/**
 * @description Admin invoices collection endpoint. GET lists every invoice
 * (newest issue date first). POST creates one: validates line items, allocates
 * the next TTP-YYYY-XXXX number, computes totals via {@link calcInvoiceTotals}
 * (promo + unsuccessful-work discounts reduce the taxable amount), writes back
 * the Sheets counter, then fire-and-forget renders the PDF and uploads it to Drive.
 */

import { calcInvoiceTotals, isValidLineItem } from "@/features/business/lib/business";
import { uploadInvoicePdf } from "@/features/business/lib/google-drive";
import {
  getNextInvoiceNumber,
  writeBackInvoiceCounter,
} from "@/features/business/lib/invoice-numbering";
import { extractYearCode, generateInvoicePdf } from "@/features/business/lib/invoice-pdf";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { parseAmount } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/business/invoices - Returns all invoices ordered by creation date descending.
 * @param request - Incoming Next.js request
 * @returns JSON with invoices array
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const invoices = await prisma.invoice.findMany({ orderBy: { issueDate: "desc" } });
  return NextResponse.json({ ok: true, invoices });
}

/**
 * POST /api/business/invoices - Creates a new invoice with auto-numbered TTP-YYYY-XXXX number.
 * @param request - Incoming Next.js request with invoice data in body
 * @returns JSON with the created invoice and optional sheet sync warning
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = await request.json();
  const {
    clientName,
    clientEmail,
    issueDate,
    dueDate,
    lineItems,
    notes,
    contactId,
    // Optional promo snapshot from the calculator (persisted for history).
    promoTitle,
    promoDiscount,
    // Optional unsuccessful-work flag + discount snapshot. Audit trail so
    // the admin dashboard can count how often the half-price clause fires.
    unsuccessful,
    unsuccessfulDiscount,
  } = body as {
    clientName?: string;
    clientEmail?: string;
    issueDate?: string;
    dueDate?: string;
    lineItems?: { qty: number; unitPrice: number; description: string; lineTotal: number }[];
    notes?: string | null;
    contactId?: string | null;
    promoTitle?: string | null;
    promoDiscount?: number | null;
    unsuccessful?: boolean;
    unsuccessfulDiscount?: number | null;
  };

  if (!clientName || !clientEmail || !Array.isArray(lineItems)) {
    return errorResponse("Missing required fields", 400);
  }
  // Guard each item before it reaches calcInvoiceTotals / prisma.create - a
  // non-finite qty/unitPrice/lineTotal would persist NaN totals.
  if (!lineItems.every(isValidLineItem)) {
    return errorResponse("Invalid line item", 400);
  }

  // Default issue + due dates server-side so the calculator's direct-save path
  // doesn't need to send them. Operators can still override either by sending
  // explicit issueDate / dueDate values.
  const issueDateValue = issueDate ? new Date(issueDate) : new Date();
  const identity = await getIdentity();
  const dueDateValue = dueDate
    ? new Date(dueDate)
    : new Date(Date.now() + identity.paymentTermsDays * 24 * 60 * 60 * 1000);

  // Validate the optional discount snapshots through the shared money parser so
  // a non-finite or absurd magnitude (e.g. Infinity, 1e12) can't reach the
  // persisted promoDiscount / unsuccessfulDiscount fields and print on the PDF.
  let discount = 0;
  if (promoDiscount != null) {
    const parsed = parseAmount(promoDiscount);
    if (parsed === null) return errorResponse("Invalid promo discount", 400);
    discount = parsed;
  }
  let unsuccessfulDiscountValue = 0;
  if (unsuccessfulDiscount != null) {
    const parsed = parseAmount(unsuccessfulDiscount);
    if (parsed === null) return errorResponse("Invalid unsuccessful-work discount", 400);
    unsuccessfulDiscountValue = parsed;
  }

  // Allocate the invoice number
  const { number, sheetNextCount, sheetSyncWarning } = await getNextInvoiceNumber();
  // GST mode is driven by the live pricing settings (gstRegistered); the
  // request body does not carry gst. Promo + unsuccessful both reduce the
  // taxable amount before GST (per IRD treatment of price reductions); they
  // sum into one discount argument for calcInvoiceTotals but persist as
  // separate audit fields.
  const { GST_REGISTERED } = await getPolicy();
  const { subtotal, gstAmount, total } = calcInvoiceTotals(
    lineItems,
    discount + unsuccessfulDiscountValue,
    GST_REGISTERED,
  );

  // Create the invoice
  const invoice = await prisma.invoice.create({
    data: {
      number,
      clientName,
      clientEmail,
      issueDate: issueDateValue,
      dueDate: dueDateValue,
      lineItems,
      gst: gstAmount > 0,
      subtotal,
      gstAmount,
      total,
      promoTitle: discount > 0 && promoTitle ? promoTitle : null,
      promoDiscount: discount > 0 ? discount : null,
      unsuccessful: unsuccessful === true,
      unsuccessfulDiscount: unsuccessfulDiscountValue > 0 ? unsuccessfulDiscountValue : null,
      notes: notes ?? null,
      contactId: contactId ?? null,
    },
  });

  // Keep the Sheets counter in sync; the helper swallows + logs failures
  // so the just-saved invoice isn't compromised by a transient Sheets hiccup.
  await writeBackInvoiceCounter(sheetNextCount);

  // Generate the PDF and upload to Drive, then store the Drive URL. Awaited (not
  // fire-and-forget) so it completes before the response: Vercel freezes the
  // function instance once the response is sent, so a detached promise may never
  // run, leaving driveFileId / driveWebUrl null. maxDuration is raised above so
  // the extra Google round-trips can't 504. Failures are logged and swallowed so
  // a Drive hiccup never blocks invoice creation - sync-drive backfills later.
  try {
    const pdfBuffer = await generateInvoicePdf({
      ...invoice,
      issueDate: invoice.issueDate.toISOString(),
      dueDate: invoice.dueDate.toISOString(),
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
    });
    const yearCode = extractYearCode(invoice.number);
    const { fileId, webUrl } = await uploadInvoicePdf(pdfBuffer, invoice.number, yearCode);
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { driveFileId: fileId, driveWebUrl: webUrl },
    });
  } catch (err) {
    console.error("[invoices] Drive PDF upload failed:", err);
  }

  return NextResponse.json({ ok: true, invoice, sheetSyncWarning }, { status: 201 });
}
