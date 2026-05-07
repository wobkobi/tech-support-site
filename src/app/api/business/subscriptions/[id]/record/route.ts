import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/shared/lib/prisma";
import { isAdminRequest } from "@/shared/lib/auth";
import {
  advanceNextDue,
  calcGstFromInclusive,
  formatUTCDDMMYYYY,
} from "@/features/business/lib/business";
import { getSheetsClient, getSheetId } from "@/features/business/lib/google-sheets";

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
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const sub = await prisma.subscription.findUnique({ where: { id } });
  if (!sub) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
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

  // 3. Append row to Expenses sheet
  let sheetSyncWarning = false;
  try {
    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();
    const gstPct = `${Math.round(rate * 100)}%`;
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Expenses!A:K",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            formatUTCDDMMYYYY(today),
            sub.supplier,
            sub.description,
            sub.category,
            sub.method,
            "No",
            inclNum,
            gstPct,
            gstAmount,
            amountExcl,
            sub.notes ?? "",
          ],
        ],
      },
    });
  } catch (err) {
    console.error("[subscriptions/record] Sheet append failed:", err);
    sheetSyncWarning = true;
  }

  return NextResponse.json({ ok: true, expense, nextDue: nextDue.toISOString(), sheetSyncWarning });
}
