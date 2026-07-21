// src/app/api/business/income/route.ts
/**
 * @description Admin income-ledger endpoint. GET lists every income entry
 * (newest first); POST creates one and best-effort appends a matching row to
 * the per-financial-year Cashbook sheet, storing the returned sheet row key.
 * Sheet failures are logged and swallowed so DB recording is never blocked.
 */

import { recordIncome } from "@/features/business/lib/income-recording";
import { parseAmount } from "@/features/business/lib/validation";
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

  const safeAmount = parseAmount(amount);
  if (safeAmount === null) {
    return errorResponse("Invalid amount", 400);
  }

  const { entry, sheetRowKey } = await recordIncome({
    date: new Date(date),
    customer,
    description,
    amount: safeAmount,
    method,
    notes,
    invoiceId,
  });

  return NextResponse.json({ ok: true, entry: { ...entry, sheetRowKey } }, { status: 201 });
}
