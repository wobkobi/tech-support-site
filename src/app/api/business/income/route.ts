// src/app/api/business/income/route.ts
/**
 * @description Admin income-ledger endpoint. GET lists every income entry
 * (newest first); POST creates one and best-effort appends a matching row to
 * the per-financial-year Cashbook sheet, storing the returned sheet row key.
 * Sheet failures are logged and swallowed so DB recording is never blocked.
 */

import { INCOME_METHODS } from "@/features/business/lib/constants";
import { recordIncome } from "@/features/business/lib/income-recording";
import { parseAmount, parseDate } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

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

  // Gate on INCOME_METHODS like the /pay route does. Only truthiness was
  // checked here, so an expense method or free text reached the Cashbook, whose
  // method column is a fixed Data Validation list.
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

  const { entry, sheetRowKey, sheetSyncWarning } = await recordIncome({
    date: entryDate,
    customer,
    description,
    amount: safeAmount,
    method,
    notes,
    invoiceId,
  });

  // sheetSyncWarning has to reach the client: recordIncome swallows a Cashbook append
  // failure so the entry still saves, and dropping the flag here reports a clean 201 for a
  // payment that never reached the sheet. The expenses route returns it too.
  return NextResponse.json(
    { ok: true, entry: { ...entry, sheetRowKey }, sheetSyncWarning },
    { status: 201 },
  );
}
