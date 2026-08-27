// src/features/business/lib/expense-recording.ts
/**
 * @description Shared expense-entry writer, the counterpart to
 * `income-recording.ts`: creates the ExpenseEntry, mirrors it to the per-FY
 * Expenses sheet keyed by the entry's own id (a deterministic Sync ID, so a
 * retried append reuses the row instead of doubling it), and persists the
 * returned sheetRowKey.
 */

import { splitGstInclusive } from "@/features/business/lib/business";
import {
  appendRowWithSyncId,
  buildExpenseCells,
  resolveSheetIdForDate,
} from "@/features/business/lib/sheets-sync";
import { prisma } from "@/shared/lib/prisma";
import type { ExpenseEntry } from "@prisma/client";

/** Validated input for {@link recordExpense} (the caller validates amount etc.). */
export interface RecordExpenseInput {
  /** Entry date. */
  date: Date;
  /** Supplier / payee name. */
  supplier: string;
  /** Line description. */
  description: string;
  /** Expense category. */
  category: string;
  /** GST-inclusive amount (already parsed/validated). */
  amountIncl: number;
  /** GST rate as a decimal (e.g. 0.15); the split is derived from it. */
  gstRate: number;
  /** Payment method (a PAYMENT_METHODS value). */
  method: string;
  /** Whether a receipt is held. */
  receipt?: boolean;
  /** Optional note. */
  notes?: string | null;
}

/** Result of {@link recordExpense}. */
export interface RecordExpenseResult {
  /** The created entry (its `sheetRowKey` column is set separately below). */
  entry: ExpenseEntry;
  /** The sheet row key (Sync ID) written, or null when the append was skipped. */
  sheetRowKey: string | null;
  /** True when the entry was recorded but the sheet mirror was skipped or failed. */
  sheetSyncWarning: boolean;
}

/**
 * Creates an expense entry and best-effort mirrors it to the Expenses sheet.
 * The DB write always succeeds independently of the sheet; a sheet failure sets
 * `sheetSyncWarning` and leaves `sheetRowKey` null (the cron self-heal appends
 * it later). Mirrors recordIncome's contract, including the deterministic Sync
 * ID that makes a retried append idempotent.
 * @param data - Validated expense data.
 * @returns The created entry, its sheet row key, and a sync-warning flag.
 */
export async function recordExpense(data: RecordExpenseInput): Promise<RecordExpenseResult> {
  const { gstAmount, amountExcl } = splitGstInclusive(data.amountIncl, data.gstRate);

  const entry = await prisma.expenseEntry.create({
    data: {
      date: data.date,
      supplier: data.supplier,
      description: data.description,
      category: data.category,
      amountIncl: data.amountIncl,
      gstAmount,
      amountExcl,
      method: data.method,
      receipt: data.receipt ?? false,
      notes: data.notes ?? null,
    },
  });

  // Synchronous append so the row lands before the response - Vercel can terminate the
  // function before a fire-and-forget promise resolves. Failures are swallowed (the DB
  // entry stands, the cron self-heal re-appends) but surfaced via sheetSyncWarning.
  let sheetRowKey: string | null = null;
  let sheetSyncWarning = false;
  try {
    const spreadsheetId = await resolveSheetIdForDate(entry.date);
    if (!spreadsheetId) {
      console.warn(
        `[expenses] No sheet found for ${entry.date.toISOString()} - cron self-heal will append later`,
      );
      sheetSyncWarning = true;
    } else {
      // Deterministic Sync ID = the entry id > idempotent re-append.
      sheetRowKey = await appendRowWithSyncId(
        spreadsheetId,
        "Expenses",
        buildExpenseCells(entry),
        entry.id,
      );
      await prisma.expenseEntry.update({ where: { id: entry.id }, data: { sheetRowKey } });
    }
  } catch (err) {
    console.error(`[expenses] Failed to append to sheet for entry ${entry.id}:`, err);
    sheetSyncWarning = true;
  }

  return { entry, sheetRowKey, sheetSyncWarning };
}
