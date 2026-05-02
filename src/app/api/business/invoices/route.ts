import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import { calcInvoiceTotals, nextInvoiceNumber } from "@/features/business/lib/business";

/**
 * Fetches the next invoice number from Google Sheets, falling back to MongoDB on failure.
 * @param request - Current incoming request (used to extract origin and auth header)
 * @returns Next invoice number string, sheet count for write-back, and sync warning flag
 */
async function getNextInvoiceNumber(request: NextRequest): Promise<{
  number: string;
  sheetNextCount: number | null;
  sheetSyncWarning: boolean;
}> {
  try {
    const origin = new URL(request.url).origin;
    const res = await fetch(`${origin}/api/business/sheets/invoice-counter`, {
      headers: { "x-admin-secret": request.headers.get("x-admin-secret") ?? "" },
    });
    if (!res.ok) throw new Error("Sheet fetch failed");
    const data = await res.json();
    return {
      number: data.nextFormatted,
      sheetNextCount: data.nextNumber,
      sheetSyncWarning: false,
    };
  } catch {
    // Fallback: derive number from MongoDB
    const last = await prisma.invoice.findFirst({ orderBy: { number: "desc" } });
    const now = new Date();
    const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const yearCode = String(fy).slice(2) + String(fy + 1).slice(2);
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

  const invoices = await prisma.invoice.findMany({ orderBy: { createdAt: "desc" } });
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
  const { clientName, clientEmail, issueDate, dueDate, lineItems, gst, notes, contactId } = body;

  if (!clientName || !clientEmail || !issueDate || !dueDate || !Array.isArray(lineItems)) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const { number, sheetNextCount, sheetSyncWarning } = await getNextInvoiceNumber(request);
  const { subtotal, gstAmount, total } = calcInvoiceTotals(lineItems, gst ?? false);

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
      notes: notes ?? null,
      contactId: contactId ?? null,
    },
  });

  // Write back to sheet if we got a count from it
  if (sheetNextCount !== null) {
    try {
      const origin = new URL(request.url).origin;
      await fetch(`${origin}/api/business/sheets/invoice-counter`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-admin-secret": request.headers.get("x-admin-secret") ?? "",
        },
        body: JSON.stringify({ newCount: sheetNextCount }),
      });
    } catch {
      // Non-fatal - invoice is already saved
    }
  }

  return NextResponse.json({ ok: true, invoice, sheetSyncWarning }, { status: 201 });
}
