import { calcInvoiceTotals } from "@/features/business/lib/business";
import { uploadInvoicePdf } from "@/features/business/lib/google-drive";
import {
  getNextInvoiceNumber,
  writeBackInvoiceCounter,
} from "@/features/business/lib/invoice-numbering";
import { extractYearCode, generateInvoicePdf } from "@/features/business/lib/invoice-pdf";
import { getPolicy } from "@/features/business/lib/pricing-policy.server";
import { isAdminRequest } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/business/invoices - Returns all invoices ordered by creation date descending.
 * @param request - Incoming Next.js request
 * @returns JSON with invoices array
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Default issue + due dates server-side so the calculator's direct-save path
  // doesn't need to send them. Operators can still override either by sending
  // explicit issueDate / dueDate values.
  const issueDateValue = issueDate ? new Date(issueDate) : new Date();
  const identity = await getIdentity();
  const dueDateValue = dueDate
    ? new Date(dueDate)
    : new Date(Date.now() + identity.paymentTermsDays * 24 * 60 * 60 * 1000);

  // Allocate the invoice number
  const { number, sheetNextCount, sheetSyncWarning } = await getNextInvoiceNumber();
  const discount = typeof promoDiscount === "number" && promoDiscount > 0 ? promoDiscount : 0;
  const unsuccessfulDiscountValue =
    typeof unsuccessfulDiscount === "number" && unsuccessfulDiscount > 0 ? unsuccessfulDiscount : 0;
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
      unsuccessfulDiscount:
        typeof unsuccessfulDiscount === "number" && unsuccessfulDiscount > 0
          ? unsuccessfulDiscount
          : null,
      notes: notes ?? null,
      contactId: contactId ?? null,
    },
  });

  // Keep the Sheets counter in sync; the helper swallows + logs failures
  // so the just-saved invoice isn't compromised by a transient Sheets hiccup.
  await writeBackInvoiceCounter(sheetNextCount);

  // Fire-and-forget: generate PDF and upload to Drive, then store the Drive URL
  void (async () => {
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
  })();

  return NextResponse.json({ ok: true, invoice, sheetSyncWarning }, { status: 201 });
}
