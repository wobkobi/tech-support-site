// src/app/api/business/expenses/[id]/route.ts
/**
 * @description Admin endpoint for a single expense entry. PUT updates the entry
 * (recomputing the GST split server-side) and writes the change through to its
 * Expenses sheet row (by Sync ID); DELETE removes the entry and its sheet row.
 * Sheet failures are logged and swallowed so DB changes are never blocked -
 * the sync cron reconciles any drift.
 */

import { GST_RATE } from "@/features/business/lib/pricing-policy";
import {
  appendRowWithSyncId,
  buildExpenseCells,
  deleteRowBySyncId,
  resolveSheetIdForDate,
  updateRowBySyncId,
} from "@/features/business/lib/sheets-sync";
import { parseAmount, parseRate } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow Sheets round-trip cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * PUT /api/business/expenses/[id] - Updates an expense entry and its sheet row,
 * recomputing GST and the excl-GST amount server-side.
 * @param request - Incoming Next.js request with updated expense data in body
 * @param root0 - Route context
 * @param root0.params - Route params containing the expense entry ID
 * @returns JSON with the updated entry
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;
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

  const existing = await prisma.expenseEntry.findUnique({ where: { id } });
  if (!existing) {
    return errorResponse("Expense entry not found", 404);
  }

  const gstAmount = Math.round(((inclNum * rate) / (1 + rate)) * 100) / 100;
  const amountExcl = Math.round((inclNum - gstAmount) * 100) / 100;

  const updated = await prisma.expenseEntry.update({
    where: { id },
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

  // Write through to the sheet. If the edited date moved the entry into a
  // different FY workbook, append to the new sheet BEFORE deleting the old row
  // so a failure can't strand the entry off-sheet; otherwise update in place.
  let sheetRowKey = existing.sheetRowKey;
  let sheetSyncWarning = false;
  try {
    const newSheetId = await resolveSheetIdForDate(updated.date);
    const oldSheetId = await resolveSheetIdForDate(existing.date);
    if (sheetRowKey && oldSheetId && newSheetId && newSheetId !== oldSheetId) {
      // Cross-FY move: create the new row first and persist its key, then
      // remove the old row best-effort. A failed append leaves the old row
      // intact (outer catch); a failed delete leaves a logged stray, not a
      // lost entry.
      const oldKey = sheetRowKey;
      sheetRowKey = await appendRowWithSyncId(newSheetId, "Expenses", buildExpenseCells(updated));
      await prisma.expenseEntry.update({ where: { id }, data: { sheetRowKey } });
      try {
        await deleteRowBySyncId(oldSheetId, "Expenses", oldKey);
      } catch (delErr) {
        console.error(`[expenses] Cross-FY move: old row delete failed for ${id}:`, delErr);
      }
    } else if (newSheetId) {
      if (sheetRowKey) {
        const result = await updateRowBySyncId(
          newSheetId,
          "Expenses",
          sheetRowKey,
          buildExpenseCells(updated),
        );
        sheetRowKey = result.syncId;
      } else {
        sheetRowKey = await appendRowWithSyncId(newSheetId, "Expenses", buildExpenseCells(updated));
      }
      if (sheetRowKey !== existing.sheetRowKey) {
        await prisma.expenseEntry.update({ where: { id }, data: { sheetRowKey } });
      }
    }
  } catch (err) {
    console.error(`[expenses] Failed to update sheet row for entry ${id}:`, err);
    sheetRowKey = existing.sheetRowKey;
    // The sheet still holds the old values; the sheet-wins cron would revert
    // this edit at the next pass. Surface it so the caller can toast.
    sheetSyncWarning = true;
  }

  return NextResponse.json({ ok: true, entry: { ...updated, sheetRowKey }, sheetSyncWarning });
}

/**
 * DELETE /api/business/expenses/[id] - Deletes an expense entry and its sheet row.
 * @param request - Incoming Next.js request
 * @param root0 - Route context
 * @param root0.params - Route params containing the expense entry ID
 * @returns JSON confirmation
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const { id } = await params;
  const existing = await prisma.expenseEntry.findUnique({ where: { id } });
  if (!existing) {
    return errorResponse("Expense entry not found", 404);
  }

  await prisma.expenseEntry.delete({ where: { id } });

  // Remove the matching sheet row so the import can't resurrect the entry. A
  // failed delete leaves the row behind (the cron would re-import it), so
  // surface a warning the caller can toast.
  let sheetSyncWarning = false;
  if (existing.sheetRowKey) {
    try {
      const spreadsheetId = await resolveSheetIdForDate(existing.date);
      if (spreadsheetId) {
        await deleteRowBySyncId(spreadsheetId, "Expenses", existing.sheetRowKey);
      }
    } catch (err) {
      console.error(`[expenses] Failed to delete sheet row for entry ${id}:`, err);
      sheetSyncWarning = true;
    }
  }

  return NextResponse.json({ ok: true, sheetSyncWarning });
}
