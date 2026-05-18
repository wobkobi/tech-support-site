// src/app/api/business/invoices/[id]/pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { generateInvoicePdf } from "@/features/business/lib/invoice-pdf";

/**
 * GET /api/business/invoices/[id]/pdf
 * Re-generates the PDF bytes for a saved invoice and returns them as an
 * attachment download. Same renderer used for Drive uploads + email
 * attachments, so what the operator saves is what the customer receives.
 * @param request - Next.js request, admin-auth gated.
 * @param ctx - Route ctx with the invoice id.
 * @param ctx.params - Resolved Next.js dynamic route params.
 * @returns The PDF as application/pdf or an error.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const pdfBytes = await generateInvoicePdf({
    ...invoice,
    issueDate: invoice.issueDate.toISOString(),
    dueDate: invoice.dueDate.toISOString(),
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
  });
  return new Response(new Uint8Array(pdfBytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Invoice ${invoice.number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
