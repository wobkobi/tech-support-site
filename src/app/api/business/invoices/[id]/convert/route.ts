// src/app/api/business/invoices/[id]/convert/route.ts
/**
 * @description Converts an accepted quote into a real invoice: allocates the
 * next TTP number (quote counter untouched), clears the quote flag, restamps
 * issue/due dates from today, and re-syncs the PDF to Drive under the new
 * number. The row keeps its id, so links and history carry over.
 */

import { syncInvoicePdfToDriveById } from "@/features/business/lib/invoice-drive-sync";
import {
  getNextInvoiceNumber,
  writeBackInvoiceCounter,
} from "@/features/business/lib/invoice-numbering";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling: the awaited Drive re-upload can be slow.
export const maxDuration = 60;

/**
 * POST /api/business/invoices/[id]/convert - promotes a quote to an invoice.
 * @param request - Incoming Next.js request.
 * @param params - Route parameters containing the invoice ID.
 * @param params.params - Promise resolving to the dynamic route params object.
 * @returns JSON with the converted invoice, its previous Q- number, and an
 * optional sheet sync warning.
 */
export async function POST(
  request: NextRequest,
  params: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params.params;
  let existing;
  try {
    existing = await prisma.invoice.findUnique({ where: { id } });
  } catch {
    // Malformed ObjectId throws P2023; treat as not found.
    return errorResponse("Invoice not found.", 404);
  }
  if (!existing) return errorResponse("Invoice not found.", 404);
  if (!existing.isQuote) {
    return errorResponse("This is already an invoice.", 409);
  }
  if (existing.status === "VOIDED") {
    return errorResponse("A voided quote can't be converted.", 409);
  }

  const previousNumber = existing.number;
  const identity = await getIdentity();
  const now = new Date();
  const dueDate = new Date(now.getTime() + identity.paymentTermsDays * 24 * 60 * 60 * 1000);

  // Allocate a real invoice number with the same collision-retry loop as
  // creation; the quote counter is not touched.
  let converted: Awaited<ReturnType<typeof prisma.invoice.update>> | null = null;
  let sheetNextCount: number | null = null;
  let sheetSyncWarning = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const alloc = await getNextInvoiceNumber();
    sheetNextCount = alloc.sheetNextCount;
    sheetSyncWarning = alloc.sheetSyncWarning;
    try {
      converted = await prisma.invoice.update({
        where: { id },
        data: {
          number: alloc.number,
          isQuote: null,
          quoteValidUntil: null,
          // The customer's payment clock starts at conversion, not at the
          // original quote date - restamp both dates from today.
          issueDate: now,
          dueDate,
          // Back to DRAFT regardless of whether the quote was emailed: the
          // operator reviews and sends the real invoice as its own step.
          status: "DRAFT",
          sentAt: null,
        },
      });
      break;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        attempt < 4
      ) {
        console.warn(`[invoices/convert] Number ${alloc.number} collided; re-allocating.`);
        continue;
      }
      throw err;
    }
  }
  if (!converted) {
    return errorResponse("Could not allocate a unique invoice number", 500);
  }

  await writeBackInvoiceCounter(sheetNextCount);
  console.log(`[invoices/convert] Quote ${previousNumber} converted to ${converted.number}.`);

  // Re-render + re-upload the PDF under the new number (awaited; never throws).
  await syncInvoicePdfToDriveById(id, "[invoices/convert]");

  return NextResponse.json({ ok: true, invoice: converted, previousNumber, sheetSyncWarning });
}
