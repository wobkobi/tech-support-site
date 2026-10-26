// src/app/api/business/income/route.ts
// Admin income ledger: GET lists, POST creates and best-effort appends to the FY Cashbook.

import { INCOME_METHODS } from "@/features/business/lib/constants";
import { recordIncome } from "@/features/business/lib/income-recording";
import { parseAmount, parseDate, parseObjectId } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/business/income - Returns all income entries ordered by date descending.
 * @param request - Incoming Next.js request
 * @returns JSON with entries array
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const entries = await prisma.incomeEntry.findMany({ orderBy: { date: "desc" } });
  return NextResponse.json({ ok: true, entries });
}

/**
 * POST /api/business/income - Creates a new income entry.
 * @param request - Incoming Next.js request with entry data in body
 * @returns JSON with the created entry
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = await request.json();
  const { date, customer, description, amount, method, notes, invoiceId } = body;

  if (!date || !customer || !description || amount === undefined || !method) {
    return errorResponse("Missing required fields", 400);
  }

  // The Cashbook method column is a fixed Data Validation list.
  if (!(INCOME_METHODS as readonly string[]).includes(method)) {
    return errorResponse("Invalid payment method", 400);
  }

  const safeAmount = parseAmount(amount);
  if (safeAmount === null) {
    return errorResponse("Invalid amount", 400);
  }

  const entryDate = parseDate(date);
  if (entryDate === null) {
    return errorResponse("Invalid date", 400);
  }

  // A malformed id would 500 in Prisma, and a dangling one would read as a payment.
  const linkedInvoiceId = parseObjectId(invoiceId);
  if (
    (invoiceId != null && invoiceId !== "" && !linkedInvoiceId) ||
    (linkedInvoiceId &&
      !(await prisma.invoice.findUnique({ where: { id: linkedInvoiceId }, select: { id: true } })))
  ) {
    return errorResponse("Invoice not found", 400);
  }

  const { entry, sheetRowKey, sheetSyncWarning } = await recordIncome({
    date: entryDate,
    customer,
    description,
    amount: safeAmount,
    method,
    notes,
    invoiceId: linkedInvoiceId,
  });

  // recordIncome swallows a Cashbook failure, so the flag is the only signal.
  return NextResponse.json(
    { ok: true, entry: { ...entry, sheetRowKey }, sheetSyncWarning },
    { status: 201 },
  );
}
