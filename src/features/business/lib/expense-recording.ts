// src/features/business/lib/expense-recording.ts
// Shared expense-entry writer: creates the ExpenseEntry and mirrors it to the per-FY Expenses
// sheet, keyed by the entry id so a retried append reuses the row.

import { splitGstInclusive } from "@/features/business/lib/business";
import { GST_RATE } from "@/features/business/lib/pricing-policy";
import {
  appendRowWithSyncId,
  buildExpenseCells,
  resolveSheetIdForDate,
} from "@/features/business/lib/sheets-sync";
import { expenseGstRateOn } from "@/features/business/lib/tax/gst-basis";
import { loadGstStatus } from "@/features/business/lib/tax/load";
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
  /** GST rate as a decimal (0.15); omitted = 0 while unregistered, else {@link GST_RATE}. */
  gstRate?: number;
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
 * Creates an expense entry and best-effort mirrors it to the Expenses sheet, as recordIncome
 * does. A sheet failure sets `sheetSyncWarning`; the cron self-heal appends it later.
 * @param data - Validated expense data.
 * @returns The created entry, its sheet row key, and a sync-warning flag.
 */
export async function recordExpense(data: RecordExpenseInput): Promise<RecordExpenseResult> {
  const rate = data.gstRate ?? expenseGstRateOn(data.date, await loadGstStatus(), GST_RATE);
  const { gstAmount, amountExcl } = splitGstInclusive(data.amountIncl, rate);

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

  // Await the append: Vercel can kill the function before a fire-and-forget resolves.
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
