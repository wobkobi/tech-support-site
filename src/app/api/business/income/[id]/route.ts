// src/app/api/business/income/[id]/route.ts
/**
 * @description Admin endpoint for a single income entry. PUT updates the entry
 * and writes the change through to its Cashbook sheet row (by Sync ID); DELETE
 * removes the entry and its sheet row. Sheet failures are logged and swallowed
 * so DB changes are never blocked - the sync cron reconciles any drift.
 */

import {
  appendRowWithSyncId,
  buildCashbookCells,
  deleteRowBySyncId,
  resolveSheetIdForDate,
  updateRowBySyncId,
} from "@/features/business/lib/sheets-sync";
import { parseAmount } from "@/features/business/lib/validation";
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
  const safeAmount = parseAmount(amount);
  if (safeAmount === null) {
    return errorResponse("Invalid amount", 400);
  }

  const existing = await prisma.incomeEntry.findUnique({ where: { id } });
  if (!existing) {
    return errorResponse("Income entry not found", 404);
  }

  const entryDate = new Date(date);
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

  // Write through to the sheet. If the edited date moved the entry into a
  // different FY workbook, delete the row from the old sheet and append to the
  // new one; otherwise update the existing row in place by Sync ID.
  let sheetRowKey = existing.sheetRowKey;
  try {
    const newSheetId = await resolveSheetIdForDate(updated.date);
    const oldSheetId = await resolveSheetIdForDate(existing.date);
    if (sheetRowKey && oldSheetId && newSheetId !== oldSheetId) {
      await deleteRowBySyncId(oldSheetId, "Cashbook", sheetRowKey);
      sheetRowKey = null;
    }
    if (newSheetId) {
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
    }
    if (sheetRowKey !== existing.sheetRowKey) {
      await prisma.incomeEntry.update({ where: { id }, data: { sheetRowKey } });
    }
  } catch (err) {
    console.error(`[income] Failed to update sheet row for entry ${id}:`, err);
    sheetRowKey = existing.sheetRowKey;
  }

  return NextResponse.json({ ok: true, entry: { ...updated, sheetRowKey } });
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

  // Remove the matching sheet row so the import can't resurrect the entry.
  if (existing.sheetRowKey) {
    try {
      const spreadsheetId = await resolveSheetIdForDate(existing.date);
      if (spreadsheetId) {
        await deleteRowBySyncId(spreadsheetId, "Cashbook", existing.sheetRowKey);
      }
    } catch (err) {
      console.error(`[income] Failed to delete sheet row for entry ${id}:`, err);
    }
  }

  return NextResponse.json({ ok: true });
}
