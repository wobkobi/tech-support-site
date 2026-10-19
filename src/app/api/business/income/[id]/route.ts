// src/app/api/business/income/[id]/route.ts
// Admin single income entry: PUT/DELETE write through to the Cashbook row by Sync ID.
// Sheet failures are logged and surfaced as a warning, never blocking the DB change.

import { INCOME_METHODS } from "@/features/business/lib/constants";
import {
  appendRowWithSyncId,
  buildCashbookCells,
  deleteRowBySyncId,
  resolveSheetIdForDate,
  updateRowBySyncId,
} from "@/features/business/lib/sheets-sync";
import { parseAmount, parseDate } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

/**
 * PUT /api/business/income/[id] - Updates an income entry and its sheet row.
 * @param request - Incoming Next.js request with updated entry data in body
 * @param root0 - Route context
 * @param root0.params - Route params containing the income entry ID
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
  const { date, customer, description, amount, method, notes } = body;

  if (!date || !customer || !description || amount === undefined || !method) {
    return errorResponse("Missing required fields", 400);
  }
  // The Cashbook's validation list rejects any other method.
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

  const existing = await prisma.incomeEntry.findUnique({ where: { id } });
  if (!existing) {
    return errorResponse("Income entry not found", 404);
  }

  const updated = await prisma.incomeEntry.update({
    where: { id },
    data: {
      date: entryDate,
      customer,
      description,
      amount: safeAmount,
      method,
      notes: notes ?? null,
    },
  });

  // A date move into another FY workbook appends BEFORE deleting the old row, so a
  // failure can't strand the entry off-sheet.
  let sheetRowKey = existing.sheetRowKey;
  let sheetSyncWarning = false;
  try {
    const newSheetId = await resolveSheetIdForDate(updated.date);
    const oldSheetId = await resolveSheetIdForDate(existing.date);
    if (sheetRowKey && oldSheetId && newSheetId && newSheetId !== oldSheetId) {
      // A failed delete leaves a logged stray rather than a lost entry.
      const oldKey = sheetRowKey;
      sheetRowKey = await appendRowWithSyncId(newSheetId, "Cashbook", buildCashbookCells(updated));
      await prisma.incomeEntry.update({ where: { id }, data: { sheetRowKey } });
      try {
        await deleteRowBySyncId(oldSheetId, "Cashbook", oldKey);
      } catch (delErr) {
        console.error(`[income] Cross-FY move: old row delete failed for ${id}:`, delErr);
      }
    } else if (newSheetId) {
      if (sheetRowKey) {
        const result = await updateRowBySyncId(
          newSheetId,
          "Cashbook",
          sheetRowKey,
          buildCashbookCells(updated),
        );
        sheetRowKey = result.syncId;
      } else {
        sheetRowKey = await appendRowWithSyncId(
          newSheetId,
          "Cashbook",
          buildCashbookCells(updated),
        );
      }
      if (sheetRowKey !== existing.sheetRowKey) {
        await prisma.incomeEntry.update({ where: { id }, data: { sheetRowKey } });
      }
    }
  } catch (err) {
    console.error(`[income] Failed to update sheet row for entry ${id}:`, err);
    sheetRowKey = existing.sheetRowKey;
    // The sheet-wins cron would revert this edit, so warn the caller.
    sheetSyncWarning = true;
  }

  return NextResponse.json({ ok: true, entry: { ...updated, sheetRowKey }, sheetSyncWarning });
}

/**
 * DELETE /api/business/income/[id] - Deletes an income entry and its sheet row.
 * @param request - Incoming Next.js request
 * @param root0 - Route context
 * @param root0.params - Route params containing the income entry ID
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
  const existing = await prisma.incomeEntry.findUnique({ where: { id } });
  if (!existing) {
    return errorResponse("Income entry not found", 404);
  }

  await prisma.incomeEntry.delete({ where: { id } });

  // A sheet row left behind would be re-imported, so a failure warns the caller.
  let sheetSyncWarning = false;
  if (existing.sheetRowKey) {
    try {
      const spreadsheetId = await resolveSheetIdForDate(existing.date);
      if (spreadsheetId) {
        await deleteRowBySyncId(spreadsheetId, "Cashbook", existing.sheetRowKey);
      } else {
        // No sheet resolved (missing or renamed FY folder); the row survives.
        console.error(`[income] No sheet resolved for entry ${id}; sheet row left in place`);
        sheetSyncWarning = true;
      }
    } catch (err) {
      console.error(`[income] Failed to delete sheet row for entry ${id}:`, err);
      sheetSyncWarning = true;
    }
  }

  return NextResponse.json({ ok: true, sheetSyncWarning });
}
