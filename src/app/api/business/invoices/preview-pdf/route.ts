// src/app/api/business/invoices/preview-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/shared/lib/auth";
import { generateInvoicePdf } from "@/features/business/lib/invoice-pdf";
import type { Invoice, LineItem } from "@/features/business/types/business";

interface PreviewPayload {
  number: string;
  clientName: string;
  clientEmail: string;
  issueDate: string;
  dueDate: string;
  lineItems: LineItem[];
  gst: boolean;
  subtotal: number;
  gstAmount: number;
  total: number;
  promoTitle?: string | null;
  promoDiscount?: number | null;
  notes?: string | null;
}

/**
 * POST /api/business/invoices/preview-pdf
 * Generates the actual customer-facing PDF for an UNSAVED invoice (used by
 * the builder's "Save PDF" button so the operator gets the same bytes the
 * customer would receive, instead of the browser's window.print() screenshot
 * of the HTML preview).
 * @param request - Next.js request, admin-auth gated, body is the form state.
 * @returns The rendered PDF as application/pdf with a download header.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as PreviewPayload;
  if (!body.number || !body.clientName) {
    return NextResponse.json({ error: "number and clientName are required" }, { status: 400 });
  }

  // Build the minimum Invoice shape generateInvoicePdf needs. Status is
  // forced to DRAFT so the watermark stays off for in-progress previews.
  const invoice: Invoice = {
    id: "preview",
    number: body.number,
    clientName: body.clientName,
    clientEmail: body.clientEmail,
    issueDate: new Date(body.issueDate),
    dueDate: new Date(body.dueDate),
    lineItems: body.lineItems,
    gst: body.gst,
    subtotal: body.subtotal,
    gstAmount: body.gstAmount,
    total: body.total,
    promoTitle: body.promoTitle ?? null,
    promoDiscount: body.promoDiscount ?? null,
    status: "DRAFT",
    notes: body.notes ?? null,
    contactId: null,
    driveFileId: null,
    driveWebUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Invoice;

  const pdfBytes = await generateInvoicePdf(invoice);

  return new Response(new Uint8Array(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Invoice ${body.number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
