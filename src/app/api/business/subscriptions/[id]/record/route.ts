// src/app/api/business/subscriptions/[id]/record/route.ts
/**
 * @description Admin endpoint to record a single subscription payment. POST
 * creates an ExpenseEntry with the GST split, advances the subscription's
 * nextDue, and appends a row to the Expenses Google Sheet. Sheet-append failures
 * are non-fatal and surface as a sheetSyncWarning flag in the response.
 */

import { advanceNextDue, calcGstFromInclusive } from "@/features/business/lib/business";
import {
  appendRowWithSyncId,
  buildExpenseCells,
  resolveSheetIdForDate,
} from "@/features/business/lib/sheets-sync";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * POST /api/business/subscriptions/[id]/record - Records one subscription payment.
 * Creates an ExpenseEntry, advances nextDue, and appends a row to the Expenses sheet.
 * @param request - Incoming Next.js request.
 * @param root0 - Route context.
 * @param root0.params - Route params promise.
 * @returns JSON with the created expense, new nextDue, and optional sheetSyncWarning.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;

  const sub = await prisma.subscription.findUnique({ where: { id } });
  if (!sub) {
    return errorResponse("Subscription not found", 404);
  }

  const today = new Date();
  const rate = sub.gstRate;
  const inclNum = sub.amountIncl;
  const gstAmount = calcGstFromInclusive(inclNum, rate);
  const amountExcl = Math.round((inclNum - gstAmount) * 100) / 100;

  // 1. Create expense entry
  const expense = await prisma.expenseEntry.create({
    data: {
      date: today,
      supplier: sub.supplier,
      description: sub.description,
      category: sub.category,
      amountIncl: inclNum,
      gstAmount,
      amountExcl,
      method: sub.method,
      receipt: false,
      notes: sub.notes,
    },
  });

  // 2. Advance nextDue
  const nextDue = advanceNextDue(sub.nextDue, sub.frequency);
  await prisma.subscription.update({ where: { id }, data: { nextDue } });

  // 3. Append row to the per-FY Expenses sheet with a Sync ID so the row joins
  // the two-way sync. Failures leave sheetRowKey null for the cron self-heal.
  let sheetSyncWarning = false;
  try {
    const spreadsheetId = await resolveSheetIdForDate(today);
    if (spreadsheetId) {
      const sheetRowKey = await appendRowWithSyncId(
        spreadsheetId,
        "Expenses",
        buildExpenseCells(expense),
      );
      await prisma.expenseEntry.update({ where: { id: expense.id }, data: { sheetRowKey } });
    } else {
      sheetSyncWarning = true;
    }
  } catch (err) {
    console.error("[subscriptions/record] Sheet append failed:", err);
    sheetSyncWarning = true;
  }

  return NextResponse.json({ ok: true, expense, nextDue: nextDue.toISOString(), sheetSyncWarning });
}
