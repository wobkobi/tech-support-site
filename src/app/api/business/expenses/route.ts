// src/app/api/business/expenses/route.ts
/**
 * @description Admin expense-ledger endpoint. GET lists every expense entry
 * (newest first); POST creates one, computing GST and the excl-GST amount
 * server-side from the GST-inclusive amount and rate.
 */

import { recordExpense } from "@/features/business/lib/expense-recording";
import { GST_RATE } from "@/features/business/lib/pricing-policy";
import { parseAmount, parseDate, parseRate } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow Sheets round-trip cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/business/expenses - Returns all expense entries ordered by date descending.
 * @param request - Incoming Next.js request
 * @returns JSON with entries array
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const entries = await prisma.expenseEntry.findMany({ orderBy: { date: "desc" } });
  return NextResponse.json({ ok: true, entries });
}

/**
 * POST /api/business/expenses - Creates a new expense entry with server-side GST calculation.
 * @param request - Incoming Next.js request with expense data in body
 * @returns JSON with the created entry including calculated GST and excl amounts
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const body = await request.json();
  const { date, supplier, description, category, amountIncl, gstRate, method, receipt, notes } =
    body;

  if (!date || !supplier || !description || !category || amountIncl === undefined || !method) {
    return errorResponse("Missing required fields", 400);
  }

  const inclNum = parseAmount(amountIncl);
  if (inclNum === null) {
    return errorResponse("Invalid amount", 400);
  }

  const rate = gstRate === undefined ? GST_RATE : parseRate(gstRate);
  if (rate === null) {
    return errorResponse("Invalid GST rate", 400);
  }

  const entryDate = parseDate(date);
  if (entryDate === null) {
    return errorResponse("Invalid date", 400);
  }

  const { entry, sheetRowKey, sheetSyncWarning } = await recordExpense({
    date: entryDate,
    supplier,
    description,
    category,
    amountIncl: inclNum,
    gstRate: rate,
    method,
    receipt,
    notes,
  });

  return NextResponse.json(
    { ok: true, entry: { ...entry, sheetRowKey }, sheetSyncWarning },
    { status: 201 },
  );
}
