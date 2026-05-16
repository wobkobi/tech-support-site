import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { calcInvoiceTotals, nextInvoiceNumber } from "@/features/business/lib/business";
import { generateInvoicePdf, extractYearCode } from "@/features/business/lib/invoice-pdf";
import { uploadInvoicePdf } from "@/features/business/lib/google-drive";
import { getInvoiceCounter, setInvoiceCounter } from "@/features/business/lib/google-sheets";

/**
 * Fetches the next invoice number from Google Sheets, falling back to MongoDB on failure.
 * @returns Next invoice number string, sheet count for write-back, and sync warning flag
 */
async function getNextInvoiceNumber(): Promise<{
  number: string;
  sheetNextCount: number | null;
  sheetSyncWarning: boolean;
}> {
  try {
    const data = await getInvoiceCounter();
    return { number: data.nextFormatted, sheetNextCount: data.nextNumber, sheetSyncWarning: false };
  } catch {
    const last = await prisma.invoice.findFirst({ orderBy: { number: "desc" } });
    const now = new Date();
    const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const yearCode = String(fy) + String(fy + 1).slice(2);
    return {
      number: nextInvoiceNumber(last?.number ?? null, yearCode),
      sheetNextCount: null,
      sheetSyncWarning: true,
    };
  }
}

/**
 * GET /api/business/invoices - Returns all invoices ordered by creation date descending.
 * @param request - Incoming Next.js request
 * @returns JSON with invoices array
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
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
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    clientName,
    clientEmail,
    issueDate,
    dueDate,
    lineItems,
    gst,
    notes,
    contactId,
    // Optional promo snapshot from the calculator (persisted for history).
    promoTitle,
    promoDiscount,
  } = body as {
    clientName?: string;
    clientEmail?: string;
    issueDate?: string;
    dueDate?: string;
    lineItems?: { qty: number; unitPrice: number; description: string; lineTotal: number }[];
    gst?: boolean;
    notes?: string | null;
    contactId?: string | null;
    promoTitle?: string | null;
    promoDiscount?: number | null;
  };

  if (!clientName || !clientEmail || !issueDate || !dueDate || !Array.isArray(lineItems)) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { number, sheetNextCount, sheetSyncWarning } = await getNextInvoiceNumber();
  const discount = typeof promoDiscount === "number" && promoDiscount > 0 ? promoDiscount : 0;
  const { subtotal, gstAmount, total } = calcInvoiceTotals(lineItems, gst ?? false, discount);

  const invoice = await prisma.invoice.create({
    data: {
      number,
      clientName,
      clientEmail,
      issueDate: new Date(issueDate),
      dueDate: new Date(dueDate),
      lineItems,
      gst: gst ?? false,
      subtotal,
      gstAmount,
      total,
      promoTitle: discount > 0 && promoTitle ? promoTitle : null,
      promoDiscount: discount > 0 ? discount : null,
      notes: notes ?? null,
      contactId: contactId ?? null,
    },
  });

  // Write back to sheet if we got a count from it
  if (sheetNextCount !== null) {
    try {
      await setInvoiceCounter(sheetNextCount);
    } catch {
      // Non-fatal - invoice is already saved
    }
  }

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
