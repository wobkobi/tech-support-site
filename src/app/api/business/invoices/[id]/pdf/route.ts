// src/app/api/business/invoices/[id]/pdf/route.ts
/**
 * @description Admin endpoint that downloads the PDF for a saved invoice. GET
 * re-generates the bytes with the same renderer used for Drive uploads and email
 * attachments and returns them as an attachment, so the operator's copy matches
 * what the customer receives.
 */

import { generateInvoicePdf } from "@/features/business/lib/invoice-pdf";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

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
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await ctx.params;
  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    return errorResponse("Invoice not found", 404);
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
