// src/app/api/business/invoices/preview-pdf/route.ts
// Renders the customer-facing PDF for an UNSAVED invoice from the builder's form state.

import { generateInvoicePdf } from "@/features/business/lib/invoice-pdf";
import { parseDate } from "@/features/business/lib/validation";
import type { Invoice, LineItem } from "@/features/business/types/business";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest } from "next/server";

interface PreviewPayload {
  number: string;
  clientName: string;
  clientEmail: string;
  issueDate: string;
  dueDate: string;
  lineItems: LineItem[];
  subtotal: number;
  gstAmount: number;
  total: number;
  promoTitle?: string | null;
  promoDiscount?: number | null;
  notes?: string | null;
}

/**
 * POST /api/business/invoices/preview-pdf
 * The real PDF bytes for the builder's "Save PDF" button, not a print of the preview.
 * @param request - Next.js request, admin-auth gated, body is the form state.
 * @returns The rendered PDF as application/pdf with a download header.
 */
export async function POST(request: NextRequest): Promise<Response> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = (await request.json()) as PreviewPayload;
  if (!body.number || !body.clientName) {
    return errorResponse("number and clientName are required", 400);
  }
  // A cleared date input would make toISOString throw a RangeError.
  const issueDate = parseDate(body.issueDate);
  const dueDate = parseDate(body.dueDate);
  if (!issueDate || !dueDate) {
    return errorResponse("Enter a valid issue date and due date", 400);
  }

  // DRAFT keeps the watermark off.
  const invoice: Invoice = {
    id: "preview",
    number: body.number,
    clientName: body.clientName,
    clientEmail: body.clientEmail,
    issueDate,
    dueDate,
    lineItems: body.lineItems,
    gst: body.gstAmount > 0,
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
