// src/features/business/lib/income-recording.ts
// Shared income-entry writer for the income route and invoice /pay: creates the IncomeEntry
// and mirrors it to the per-FY Cashbook sheet, keyed by the entry id.

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
 * Creates an income entry and best-effort mirrors it to the Cashbook sheet. A sheet failure
 * sets `sheetSyncWarning`; the cron self-heal appends it later.
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

  // Await the append: Vercel can kill the function before a fire-and-forget resolves.
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
