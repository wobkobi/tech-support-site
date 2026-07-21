// src/features/business/lib/income-recording.ts
/**
 * @description Shared income-entry writer: creates the IncomeEntry, mirrors it
 * to the per-FY Cashbook sheet keyed by the entry's own id (a deterministic
 * Sync ID, so a retried append reuses the row instead of doubling it), and
 * persists the returned sheetRowKey. Extracted from POST /api/business/income so
 * the invoice /pay route reuses exactly the same write path.
 */

import {
  appendRowWithSyncId,
  buildCashbookCells,
  resolveSheetIdForDate,
} from "@/features/business/lib/sheets-sync";
import { prisma } from "@/shared/lib/prisma";
import type { IncomeEntry } from "@prisma/client";

/** Validated input for {@link recordIncome} (the caller validates amount etc.). */
export interface RecordIncomeInput {
  /** Entry date. */
  date: Date;
  /** Customer / payer name. */
  customer: string;
  /** Line description. */
  description: string;
  /** Amount (already parsed/validated). */
  amount: number;
  /** Income method (an INCOME_METHODS value). */
  method: string;
  /** Optional note. */
  notes?: string | null;
  /** Optional linked invoice id. */
  invoiceId?: string | null;
}

/** Result of {@link recordIncome}. */
export interface RecordIncomeResult {
  /** The created entry (its `sheetRowKey` column is set separately below). */
  entry: IncomeEntry;
  /** The sheet row key (Sync ID) written, or null when the append was skipped. */
  sheetRowKey: string | null;
  /** True when the entry was recorded but the sheet mirror was skipped or failed. */
  sheetSyncWarning: boolean;
}

/**
 * Creates an income entry and best-effort mirrors it to the Cashbook sheet. The
 * DB write always succeeds independently of the sheet; a sheet failure sets
 * `sheetSyncWarning` and leaves `sheetRowKey` null (the cron self-heal appends
 * it later). The sheet row is keyed by the entry id so a retried append reuses
 * the row rather than doubling it.
 * @param data - Validated income data.
 * @returns The created entry, its sheet row key, and a sync-warning flag.
 */
export async function recordIncome(data: RecordIncomeInput): Promise<RecordIncomeResult> {
  const entry = await prisma.incomeEntry.create({
    data: {
      date: data.date,
      customer: data.customer,
      description: data.description,
      amount: data.amount,
      method: data.method,
      notes: data.notes ?? null,
      invoiceId: data.invoiceId ?? null,
    },
  });

  // Synchronous append so the row is written before the response (Vercel can
  // terminate the function before a fire-and-forget promise resolves). Failures
  // are swallowed - the DB entry stands and the cron self-heal re-appends later
  // - but surfaced to the caller via sheetSyncWarning.
  let sheetRowKey: string | null = null;
  let sheetSyncWarning = false;
  try {
    const spreadsheetId = await resolveSheetIdForDate(data.date);
    if (!spreadsheetId) {
      console.warn(
        `[income] No sheet found for ${data.date.toISOString()} - cron self-heal will append later`,
      );
      sheetSyncWarning = true;
    } else {
      // Deterministic Sync ID = the entry id > idempotent re-append.
      sheetRowKey = await appendRowWithSyncId(
        spreadsheetId,
        "Cashbook",
        buildCashbookCells(entry),
        entry.id,
      );
      await prisma.incomeEntry.update({ where: { id: entry.id }, data: { sheetRowKey } });
    }
  } catch (err) {
    console.error(`[income] Failed to append to sheet for entry ${entry.id}:`, err);
    sheetSyncWarning = true;
  }

  return { entry, sheetRowKey, sheetSyncWarning };
}
