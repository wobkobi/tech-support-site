// src/app/api/business/expenses/route.ts
/**
 * @description Admin expense-ledger endpoint. GET lists every expense entry
 * (newest first); POST creates one, computing GST and the excl-GST amount
 * server-side from the GST-inclusive amount and rate.
 */

import { GST_RATE } from "@/features/business/lib/pricing-policy";
import {
  appendRowWithSyncId,
  buildExpenseCells,
  resolveSheetIdForDate,
} from "@/features/business/lib/sheets-sync";
import { parseAmount, parseRate } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

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

  const gstAmount = Math.round(((inclNum * rate) / (1 + rate)) * 100) / 100;
  const amountExcl = Math.round((inclNum - gstAmount) * 100) / 100;

  const entry = await prisma.expenseEntry.create({
    data: {
      date: new Date(date),
      supplier,
      description,
      category,
      amountIncl: inclNum,
      gstAmount,
      amountExcl,
      method,
      receipt: receipt ?? false,
      notes: notes ?? null,
    },
  });

  // Append to the per-FY Expenses sheet. Synchronous so the row is written
  // before the response; failures are logged and swallowed - the sync cron
  // self-heals entries left without a sheetRowKey.
  let sheetRowKey: string | null = null;
  try {
    const spreadsheetId = await resolveSheetIdForDate(entry.date);
    if (!spreadsheetId) {
      console.warn(
        `[expenses] No sheet found for ${entry.date.toISOString()} - cron self-heal will append later`,
      );
    } else {
      sheetRowKey = await appendRowWithSyncId(spreadsheetId, "Expenses", buildExpenseCells(entry));
      await prisma.expenseEntry.update({ where: { id: entry.id }, data: { sheetRowKey } });
    }
  } catch (err) {
    console.error(`[expenses] Failed to append to sheet for entry ${entry.id}:`, err);
  }

  return NextResponse.json({ ok: true, entry: { ...entry, sheetRowKey } }, { status: 201 });
}
