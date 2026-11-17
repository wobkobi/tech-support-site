// src/features/business/lib/sheets-import.ts
// Sheet > site reconciliation for the Cashbook and Expenses tabs; the sheet wins, joined on the
// column-Z Sync ID. Also self-heals entries whose sheet append failed, and removes site rows
// deleted in the Sheet (guarded by sheets-deletions.ts), under a Setting lock.
import { calcGstFromInclusive } from "@/features/business/lib/business";
import { listSpreadsheetsInFolder } from "@/features/business/lib/google-drive";
import { withRetry } from "@/features/business/lib/google-retry";
import { getSheetId, getSheetsClient } from "@/features/business/lib/google-sheets";
import { GST_RATE } from "@/features/business/lib/pricing-policy";
import {
  describeLedgerRow,
  planSheetDeletions,
  rowHasData,
  type LinkedLedgerRow,
  type SheetDeletionPlan,
} from "@/features/business/lib/sheets-deletions";
import {
  appendRowWithSyncId,
  backfillSyncIds,
  buildCashbookCells,
  buildExpenseCells,
  resolveSheetIdForDate,
} from "@/features/business/lib/sheets-sync";
import { expenseGstRateOn } from "@/features/business/lib/tax/gst-basis";
import { loadGstStatus } from "@/features/business/lib/tax/load";
import type { GstStatus } from "@/features/business/lib/tax/types";
import { parseObjectId } from "@/features/business/lib/validation";
import { sendOwnerPush } from "@/features/notifications/lib/push";
import { parseSheetDate } from "@/shared/lib/date-format";
import { roundCents } from "@/shared/lib/money";
import { prisma } from "@/shared/lib/prisma";
import { acquireRunLock, releaseRunLock } from "@/shared/lib/run-lock";
import type { ExpenseEntry, IncomeEntry } from "@prisma/client";
import { randomUUID } from "crypto";

/** Setting key for the run lock shared by the cron and the manual import. */
const LOCK_KEY = "sync-sheets-lock";

/** Column Z (0-indexed 25) carries the Sync ID; must match sheets-sync.ts. */
const SYNC_ID_COLUMN_INDEX = 25;

/** Site entries younger than this with no sheet row are self-heal appended. */
const SELF_HEAL_MAX_AGE_MS = 24 * 60 * 60_000;

/** Even with no workbook changed, read them all this often so the deletion pass re-checks. */
const FULL_SCAN_EVERY_MS = 24 * 60 * 60_000;

/** Columns the owner types into: date, customer, description, amount (Cashbook). */
const CASHBOOK_DATA_COLUMNS = [0, 1, 2, 4] as const;

/** Columns the owner types into: date, supplier, description, amount incl. GST (Expenses). */
const EXPENSES_DATA_COLUMNS = [0, 1, 2, 6] as const;

/**
 * Strips currency symbols and commas, returning a float or null.
 * @param raw - Raw cell value.
 * @returns Parsed number or null.
 */
function parseAmount(raw: string): number | null {
  const n = parseFloat(raw.replace(/[$,\s]/g, ""));
  return isNaN(n) ? null : n;
}

/**
 * Parses a GST rate string like "15%" or "0.15" into a decimal fraction.
 * @param raw - Raw cell value.
 * @returns GST rate as a decimal (e.g. 0.15), or null for a blank or unreadable cell so the
 *   caller can fall back to the rate for the row's date.
 */
function parseGstRate(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = parseFloat(t);
  if (isNaN(n)) return null;
  return t.endsWith("%") || n > 1 ? n / 100 : n;
}

interface PerSheetCounts {
  /** Drive file ID of the spreadsheet that was imported. */
  fileId: string;
  /** Display name of the spreadsheet. */
  name: string;
  incomeImported: number;
  incomeUpdated: number;
  incomeSkipped: number;
  expensesImported: number;
  expensesUpdated: number;
  expensesSkipped: number;
  /** True when both tabs came back with no rows at all. */
  empty: boolean;
  errors: string[];
}

/** One site row in a deletion report. */
interface DeletionReportRow {
  kind: "income" | "expense";
  id: string;
  /** Ledger date, YYYY-MM-DD. */
  date: string;
  /** Customer or supplier. */
  party: string;
  description: string;
  amount: number;
  invoiceId: string | null;
  /** Why a held row was left in place. */
  held?: "half-edited" | "recent";
}

/** What the deletion pass did (or, on a dry run, would do). */
export interface DeletionReport {
  /** "skipped" when the run didn't read every workbook, so it couldn't tell. */
  status: "applied" | "dry-run" | "blocked" | "skipped";
  /** Why a blocked pass removed nothing. */
  reason?: string;
  /** Rows removed (applied), that would be removed (dry-run), or held back (blocked). */
  rows: DeletionReportRow[];
  /** Missing rows left for a later run: half-edited in the Sheet, or written very recently. */
  held: DeletionReportRow[];
}

export interface ImportResult {
  ok: boolean;
  /** True when another run held the lock and this one did nothing. */
  locked?: boolean;
  /** Aggregated counts across every spreadsheet processed. */
  incomeImported: number;
  incomeUpdated: number;
  incomeSkipped: number;
  expensesImported: number;
  expensesUpdated: number;
  expensesSkipped: number;
  /** Site entries whose failed sheet append was retried successfully. */
  healed?: number;
  /** Workbooks that couldn't be read at all this run; row-level problems aren't counted. */
  unreadableSheets?: number;
  errors: string[];
  /** Non-fatal anomalies: unlinked legacy rows, sheet rows gone missing, etc. */
  warnings?: string[];
  /** Per-spreadsheet breakdown when scanning a Drive folder. */
  perSheet?: PerSheetCounts[];
  /** Site rows deleted in the Sheet, and what was done about them. */
  deletions?: DeletionReport;
  /** Source mode used: "folder" when scanning, "single" when falling back to GOOGLE_SHEET_ID. */
  source?: "folder" | "single";
}

/**
 * In-memory DB ledgers shared across every sheet in a run, so cross-sheet duplicate Sync IDs
 * show. Dedup maps hold only unlinked rows and are consumed as rows link.
 */
interface SyncState {
  incomeByKey: Map<string, IncomeEntry>;
  incomeByDedup: Map<string, IncomeEntry>;
  expenseByKey: Map<string, ExpenseEntry>;
  expenseByDedup: Map<string, ExpenseEntry>;
  /** Every Sync ID observed (or minted) in the scanned sheets this run. */
  seenSyncIds: Set<string>;
  /** Sync IDs on rows that hold some data but didn't parse, so aren't in seenSyncIds. */
  partialSyncIds: Set<string>;
  /** GST registration, for an Expenses row with no GST rate. */
  gst: GstStatus;
}

/** Setting key holding the Drive modifiedTime of each workbook at its last clean import. */
const WORKBOOK_MTIMES_KEY = "sheets:workbook-mtimes";

/**
 * Reads the per-workbook modifiedTime marks from the last clean import. A missing or bad row
 * means import everything, the safe direction.
 * @returns Map of Drive file id to the modifiedTime seen when it was imported.
 */
async function readWorkbookMtimes(): Promise<Record<string, string>> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: WORKBOOK_MTIMES_KEY } });
    if (!row) return {};
    const parsed: unknown = JSON.parse(row.value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Records the modifiedTime of every workbook imported or skipped this run.
 * @param mtimes - Drive file id to modifiedTime for this run's workbooks.
 */
async function writeWorkbookMtimes(mtimes: Record<string, string>): Promise<void> {
  const value = JSON.stringify(mtimes);
  await prisma.setting.upsert({
    where: { key: WORKBOOK_MTIMES_KEY },
    create: { key: WORKBOOK_MTIMES_KEY, value },
    update: { value },
  });
}

/**
 * Dedup key matching the pre-Sync-ID import behaviour.
 * @param date - Entry date.
 * @param amount - Income amount or expense GST-inclusive amount.
 * @param description - Entry description.
 * @returns Composite key string.
 */
function dedupKey(date: Date, amount: number, description: string): string {
  return `${date.toISOString()}|${amount}|${description}`;
}

/** Income fields the sheet owns; the shape written to the DB on reconcile. */
interface IncomeRowData {
  date: Date;
  customer: string;
  description: string;
  amount: number;
  method: string;
  notes: string | null;
}

/** Expense fields the sheet owns; GST split recomputed from the sheet's rate. */
interface ExpenseRowData {
  date: Date;
  supplier: string;
  description: string;
  category: string;
  amountIncl: number;
  gstAmount: number;
  amountExcl: number;
  method: string;
  receipt: boolean;
  notes: string | null;
}

/**
 * True when any sheet-owned income field differs between the DB and sheet rows.
 * @param db - Current DB entry.
 * @param data - Values parsed from the sheet row.
 * @returns Whether a DB update is needed.
 */
function incomeDiffers(db: IncomeEntry, data: IncomeRowData): boolean {
  return (
    db.date.getTime() !== data.date.getTime() ||
    db.customer !== data.customer ||
    db.description !== data.description ||
    amountDiffers(db.amount, data.amount) ||
    db.method !== data.method ||
    (db.notes ?? "") !== (data.notes ?? "")
  );
}

/**
 * True when any sheet-owned expense field differs between the DB and sheet rows.
 * @param db - Current DB entry.
 * @param data - Values parsed from the sheet row.
 * @returns Whether a DB update is needed.
 */
function expenseDiffers(db: ExpenseEntry, data: ExpenseRowData): boolean {
  return (
    db.date.getTime() !== data.date.getTime() ||
    db.supplier !== data.supplier ||
    db.description !== data.description ||
    db.category !== data.category ||
    amountDiffers(db.amountIncl, data.amountIncl) ||
    amountDiffers(db.gstAmount, data.gstAmount) ||
    db.method !== data.method ||
    db.receipt !== data.receipt ||
    (db.notes ?? "") !== (data.notes ?? "")
  );
}

/**
 * Whether two amounts differ by at least a cent, so float drift doesn't rewrite the DB hourly.
 * @param a - First amount.
 * @param b - Second amount.
 * @returns True when they round to different cents.
 */
function amountDiffers(a: number, b: number): boolean {
  return Math.round(a * 100) !== Math.round(b * 100);
}

/**
 * Notes the Sync ID of a skipped row that still holds some data, so the deletion pass treats
 * it as half-edited rather than deleted.
 * @param row - The row's cells.
 * @param dataColumns - Columns the owner types into.
 * @param state - Run state collecting the IDs.
 */
function notePartialRow(
  row: readonly string[],
  dataColumns: readonly number[],
  state: SyncState,
): void {
  const syncId = (row[SYNC_ID_COLUMN_INDEX] ?? "").trim();
  if (syncId && rowHasData(row, dataColumns)) state.partialSyncIds.add(syncId);
}

/**
 * Reconciles one spreadsheet's tabs against the DB (sheet wins). Rows without a Sync ID match
 * on date+amount+description and get one backfilled; row errors don't abort the run.
 * @param spreadsheetId - The Google Sheet ID to read.
 * @param dryRun - When true, counts what would change without writing anywhere.
 * @param state - Shared in-memory DB view for this run.
 * @returns Counts and any row-level errors.
 */
async function importFromSheet(
  spreadsheetId: string,
  dryRun: boolean,
  state: SyncState,
): Promise<Omit<PerSheetCounts, "fileId" | "name">> {
  const sheets = getSheetsClient();
  const res = await withRetry(
    () =>
      sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: ["Cashbook!A:Z", "Expenses!A:Z"],
      }),
    { label: "sheets-import" },
  );

  const [cashbookRange, expensesRange] = res.data.valueRanges ?? [];
  const cashRows: string[][] = (cashbookRange?.values ?? []) as string[][];
  const expRows: string[][] = (expensesRange?.values ?? []) as string[][];

  let incomeImported = 0;
  let incomeUpdated = 0;
  let incomeSkipped = 0;
  let expensesImported = 0;
  let expensesUpdated = 0;
  let expensesSkipped = 0;
  const errors: string[] = [];
  const cashBackfills: { rowIndex: number; syncId: string }[] = [];
  const expBackfills: { rowIndex: number; syncId: string }[] = [];

  // Reconcile Cashbook income rows
  for (let i = 0; i < cashRows.length; i++) {
    const row = cashRows[i]!;
    const date = parseSheetDate(row[0] ?? "");
    if (!date) {
      notePartialRow(row, CASHBOOK_DATA_COLUMNS, state);
      incomeSkipped++;
      continue;
    }
    const customer = (row[1] ?? "").trim();
    const description = (row[2] ?? "").trim();
    const method = (row[3] ?? "").trim();
    const amount = parseAmount(row[4] ?? "");
    const notes = (row[7] ?? "").trim() || null;

    if (!customer || !description || amount === null || amount <= 0) {
      notePartialRow(row, CASHBOOK_DATA_COLUMNS, state);
      incomeSkipped++;
      continue;
    }

    const data: IncomeRowData = {
      date,
      customer,
      description,
      amount,
      method: method || "Unknown",
      notes,
    };
    const syncId = (row[SYNC_ID_COLUMN_INDEX] ?? "").trim();

    try {
      if (syncId) {
        // Duplicate Sync ID = a copied row: skip it if identical, else import with a fresh id.
        if (state.seenSyncIds.has(syncId)) {
          const first = state.incomeByKey.get(syncId);
          if (!first || !incomeDiffers(first, data)) {
            errors.push(`Income row ${i + 1}: duplicate Sync ID ${syncId} (identical) - skipped`);
            incomeSkipped++;
            continue;
          }
          const rowKey = randomUUID();
          if (!dryRun) {
            const created = await prisma.incomeEntry.create({
              data: { ...data, sheetRowKey: rowKey },
            });
            cashBackfills.push({ rowIndex: i + 1, syncId: rowKey });
            state.incomeByKey.set(rowKey, created);
          }
          state.seenSyncIds.add(rowKey);
          errors.push(
            `Income row ${i + 1}: duplicate Sync ID ${syncId} with edited data - imported as a new entry`,
          );
          incomeImported++;
          continue;
        }
        state.seenSyncIds.add(syncId);
        const db = state.incomeByKey.get(syncId);
        if (db) {
          if (incomeDiffers(db, data)) {
            if (!dryRun) await prisma.incomeEntry.update({ where: { id: db.id }, data });
            Object.assign(db, data);
            incomeUpdated++;
          } else {
            incomeSkipped++;
          }
        } else {
          // An entry created mid-run misses the snapshot; its Sync ID is its Mongo id, so
          // look it up live (ObjectId shape only, a UUID throws) before creating a duplicate.
          const idLink = parseObjectId(syncId)
            ? await prisma.incomeEntry.findUnique({ where: { id: syncId } })
            : null;
          if (idLink) {
            if (!dryRun && !idLink.sheetRowKey) {
              await prisma.incomeEntry.update({
                where: { id: idLink.id },
                data: { sheetRowKey: syncId },
              });
            }
            idLink.sheetRowKey = syncId;
            state.incomeByKey.set(syncId, idLink);
            incomeSkipped++;
          } else {
            if (!dryRun) {
              const created = await prisma.incomeEntry.create({
                data: { ...data, sheetRowKey: syncId },
              });
              state.incomeByKey.set(syncId, created);
            }
            incomeImported++;
          }
        }
      } else {
        const key = dedupKey(date, amount, description);
        const legacy = state.incomeByDedup.get(key);
        const rowKey = randomUUID();
        if (legacy) {
          // Pre-Sync-ID row already imported: link both sides, import nothing.
          if (!dryRun) {
            await prisma.incomeEntry.update({
              where: { id: legacy.id },
              data: { sheetRowKey: rowKey },
            });
            cashBackfills.push({ rowIndex: i + 1, syncId: rowKey });
          }
          legacy.sheetRowKey = rowKey;
          state.incomeByKey.set(rowKey, legacy);
          state.incomeByDedup.delete(key);
          state.seenSyncIds.add(rowKey);
          incomeSkipped++;
        } else {
          // Fresh manual row: create the entry and tag the sheet row.
          if (!dryRun) {
            const created = await prisma.incomeEntry.create({
              data: { ...data, sheetRowKey: rowKey },
            });
            cashBackfills.push({ rowIndex: i + 1, syncId: rowKey });
            state.incomeByKey.set(rowKey, created);
          }
          state.seenSyncIds.add(rowKey);
          incomeImported++;
        }
      }
    } catch (err) {
      errors.push(`Income row ${i + 1}: ${String(err)}`);
      incomeSkipped++;
    }
  }

  // Reconcile Expenses rows
  for (let i = 0; i < expRows.length; i++) {
    const row = expRows[i]!;
    const date = parseSheetDate(row[0] ?? "");
    if (!date) {
      notePartialRow(row, EXPENSES_DATA_COLUMNS, state);
      expensesSkipped++;
      continue;
    }
    const supplier = (row[1] ?? "").trim();
    const description = (row[2] ?? "").trim();
    const category = (row[3] ?? "Other").trim();
    const method = (row[4] ?? "").trim();
    const receiptRaw = (row[5] ?? "").trim().toLowerCase();
    const receipt = receiptRaw === "yes" || receiptRaw === "true";
    const amountIncl = parseAmount(row[6] ?? "");
    // A blank rate follows registration on the row's date, as the site's own expense form does.
    const gstRate = parseGstRate(row[7] ?? "") ?? expenseGstRateOn(date, state.gst, GST_RATE);
    const notes = (row[10] ?? "").trim() || null;

    if (!supplier || !description || amountIncl === null || amountIncl <= 0) {
      notePartialRow(row, EXPENSES_DATA_COLUMNS, state);
      expensesSkipped++;
      continue;
    }

    // Never trust derived columns I/J; recompute the GST split from amount and rate.
    const gstAmount = calcGstFromInclusive(amountIncl, gstRate);
    const amountExcl = roundCents(amountIncl - gstAmount);
    const data: ExpenseRowData = {
      date,
      supplier,
      description,
      category: category || "Other",
      amountIncl,
      gstAmount,
      amountExcl,
      method: method || "Unknown",
      receipt,
      notes,
    };
    const syncId = (row[SYNC_ID_COLUMN_INDEX] ?? "").trim();

    try {
      if (syncId) {
        // Content-gated duplicate handling - see the income loop above.
        if (state.seenSyncIds.has(syncId)) {
          const first = state.expenseByKey.get(syncId);
          if (!first || !expenseDiffers(first, data)) {
            errors.push(`Expense row ${i + 1}: duplicate Sync ID ${syncId} (identical) - skipped`);
            expensesSkipped++;
            continue;
          }
          const rowKey = randomUUID();
          if (!dryRun) {
            const created = await prisma.expenseEntry.create({
              data: { ...data, sheetRowKey: rowKey },
            });
            expBackfills.push({ rowIndex: i + 1, syncId: rowKey });
            state.expenseByKey.set(rowKey, created);
          }
          state.seenSyncIds.add(rowKey);
          errors.push(
            `Expense row ${i + 1}: duplicate Sync ID ${syncId} with edited data - imported as a new entry`,
          );
          expensesImported++;
          continue;
        }
        state.seenSyncIds.add(syncId);
        const db = state.expenseByKey.get(syncId);
        if (db) {
          if (expenseDiffers(db, data)) {
            if (!dryRun) await prisma.expenseEntry.update({ where: { id: db.id }, data });
            Object.assign(db, data);
            expensesUpdated++;
          } else {
            expensesSkipped++;
          }
        } else {
          // Live id-fallback link before creating a duplicate, as in the income loop.
          const idLink = parseObjectId(syncId)
            ? await prisma.expenseEntry.findUnique({ where: { id: syncId } })
            : null;
          if (idLink) {
            if (!dryRun && !idLink.sheetRowKey) {
              await prisma.expenseEntry.update({
                where: { id: idLink.id },
                data: { sheetRowKey: syncId },
              });
            }
            idLink.sheetRowKey = syncId;
            state.expenseByKey.set(syncId, idLink);
            expensesSkipped++;
          } else {
            if (!dryRun) {
              const created = await prisma.expenseEntry.create({
                data: { ...data, sheetRowKey: syncId },
              });
              state.expenseByKey.set(syncId, created);
            }
            expensesImported++;
          }
        }
      } else {
        const key = dedupKey(date, amountIncl, description);
        const legacy = state.expenseByDedup.get(key);
        const rowKey = randomUUID();
        if (legacy) {
          if (!dryRun) {
            await prisma.expenseEntry.update({
              where: { id: legacy.id },
              data: { sheetRowKey: rowKey },
            });
            expBackfills.push({ rowIndex: i + 1, syncId: rowKey });
          }
          legacy.sheetRowKey = rowKey;
          state.expenseByKey.set(rowKey, legacy);
          state.expenseByDedup.delete(key);
          state.seenSyncIds.add(rowKey);
          expensesSkipped++;
        } else {
          if (!dryRun) {
            const created = await prisma.expenseEntry.create({
              data: { ...data, sheetRowKey: rowKey },
            });
            expBackfills.push({ rowIndex: i + 1, syncId: rowKey });
            state.expenseByKey.set(rowKey, created);
          }
          state.seenSyncIds.add(rowKey);
          expensesImported++;
        }
      }
    } catch (err) {
      errors.push(`Expense row ${i + 1}: ${String(err)}`);
      expensesSkipped++;
    }
  }

  // One batched backfill per tab; no rows were inserted or deleted, so indices still hold.
  if (!dryRun) {
    try {
      await backfillSyncIds(spreadsheetId, "Cashbook", cashBackfills);
      await backfillSyncIds(spreadsheetId, "Expenses", expBackfills);
    } catch (err) {
      errors.push(`Sync ID backfill failed: ${String(err)}`);
    }
  }

  return {
    incomeImported,
    incomeUpdated,
    incomeSkipped,
    expensesImported,
    expensesUpdated,
    expensesSkipped,
    empty: cashRows.length === 0 && expRows.length === 0,
    errors,
  };
}

/**
 * Appends site entries whose sheet append failed, if younger than {@link SELF_HEAL_MAX_AGE_MS}.
 * Older unlinked rows may be deliberate sheet-side deletions, so they only warn.
 * @param warnings - Run-level warning sink.
 * @param errors - Run-level error sink.
 * @returns Number of entries healed.
 */
async function healUnsyncedEntries(warnings: string[], errors: string[]): Promise<number> {
  let healed = 0;
  const cutoff = new Date(Date.now() - SELF_HEAL_MAX_AGE_MS);

  // Prisma reads a bare null as "exists AND is null", but new entries omit the field
  // entirely, so the OR also catches the unset shape.
  const unsyncedFilter = {
    OR: [{ sheetRowKey: null }, { sheetRowKey: { isSet: false } }],
  };
  const [incomeOrphans, expenseOrphans] = await Promise.all([
    prisma.incomeEntry.findMany({ where: unsyncedFilter }),
    prisma.expenseEntry.findMany({ where: unsyncedFilter }),
  ]);

  for (const entry of incomeOrphans) {
    if (entry.createdAt < cutoff) {
      warnings.push(`Income ${entry.id} (${entry.description}) has no linked sheet row`);
      continue;
    }
    try {
      const spreadsheetId = await resolveSheetIdForDate(entry.date);
      if (!spreadsheetId) {
        warnings.push(`Income ${entry.id}: no sheet resolves for ${entry.date.toISOString()}`);
        continue;
      }
      // Sync ID = the entry id (as recordIncome), so append-if-absent can't double-write.
      const sheetRowKey = await appendRowWithSyncId(
        spreadsheetId,
        "Cashbook",
        buildCashbookCells(entry),
        entry.id,
      );
      await prisma.incomeEntry.update({ where: { id: entry.id }, data: { sheetRowKey } });
      healed++;
    } catch (err) {
      errors.push(`Self-heal income ${entry.id}: ${String(err)}`);
    }
  }

  for (const entry of expenseOrphans) {
    if (entry.createdAt < cutoff) {
      warnings.push(`Expense ${entry.id} (${entry.description}) has no linked sheet row`);
      continue;
    }
    try {
      const spreadsheetId = await resolveSheetIdForDate(entry.date);
      if (!spreadsheetId) {
        warnings.push(`Expense ${entry.id}: no sheet resolves for ${entry.date.toISOString()}`);
        continue;
      }
      // Sync ID = the entry id (as recordExpense), so append-if-absent can't double-write.
      const sheetRowKey = await appendRowWithSyncId(
        spreadsheetId,
        "Expenses",
        buildExpenseCells(entry),
        entry.id,
      );
      await prisma.expenseEntry.update({ where: { id: entry.id }, data: { sheetRowKey } });
      healed++;
    } catch (err) {
      errors.push(`Self-heal expense ${entry.id}: ${String(err)}`);
    }
  }

  return healed;
}

/** Setting key holding when the last run read every workbook cleanly. */
const LAST_FULL_SCAN_KEY = "sheets:last-full-scan";

/** Setting key holding the last blocked-deletion push, so an unchanged block isn't re-sent hourly. */
const DELETION_BLOCK_PUSHED_KEY = "sheets:deletion-block-pushed";

/**
 * Reads a plain string Setting.
 * @param key - Setting key.
 * @returns The value, or null when unset or unreadable.
 */
async function readSettingValue(key: string): Promise<string | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Writes a plain string Setting.
 * @param key - Setting key.
 * @param value - Value to store.
 */
async function writeSettingValue(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/**
 * Reads the Sync IDs in a retired workbook's Z columns. Retired workbooks aren't imported, but
 * a row still listed in one isn't treated as deleted.
 * @param spreadsheetId - The retired workbook.
 * @returns Every Sync ID found in either tab.
 */
async function readRetiredSyncIds(spreadsheetId: string): Promise<string[]> {
  const sheets = getSheetsClient();
  const res = await withRetry(
    () =>
      sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: ["Cashbook!Z:Z", "Expenses!Z:Z"],
      }),
    { label: "sheets-import" },
  );
  return (res.data.valueRanges ?? []).flatMap((range) =>
    ((range.values ?? []) as string[][]).map((r) => (r[0] ?? "").trim()).filter(Boolean),
  );
}

/**
 * The run's DB snapshot of Sheet-linked rows, in the deletion planner's shape.
 * @param state - Run state.
 * @returns Every linked income and expense row.
 */
function linkedRowsFrom(state: SyncState): LinkedLedgerRow[] {
  const income = [...state.incomeByKey].map(([syncId, e]) => ({
    kind: "income" as const,
    id: e.id,
    syncId,
    date: e.date,
    party: e.customer,
    description: e.description,
    amount: e.amount,
    invoiceId: e.invoiceId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));
  const expenses = [...state.expenseByKey].map(([syncId, e]) => ({
    kind: "expense" as const,
    id: e.id,
    syncId,
    date: e.date,
    party: e.supplier,
    description: e.description,
    amount: e.amountIncl,
    invoiceId: null,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));
  return [...income, ...expenses];
}

/**
 * A ledger row as the import result reports it.
 * @param row - The row.
 * @param held - Why it was held back, if it was.
 * @returns The report row.
 */
function reportRow(row: LinkedLedgerRow, held?: DeletionReportRow["held"]): DeletionReportRow {
  return {
    kind: row.kind,
    id: row.id,
    date: row.date.toISOString().slice(0, 10),
    party: row.party,
    description: row.description,
    amount: row.amount,
    invoiceId: row.invoiceId,
    ...(held ? { held } : {}),
  };
}

/**
 * Removes the planned rows, each only while it still carries the Sync ID the plan saw, so a
 * row relinked mid-run survives.
 * @param rows - Rows to remove.
 * @param errors - Run-level error sink.
 * @returns The rows actually removed.
 */
async function applySheetDeletions(
  rows: readonly LinkedLedgerRow[],
  errors: string[],
): Promise<LinkedLedgerRow[]> {
  const removed: LinkedLedgerRow[] = [];
  for (const row of rows) {
    try {
      const where = { id: row.id, sheetRowKey: row.syncId };
      const { count } =
        row.kind === "income"
          ? await prisma.incomeEntry.deleteMany({ where })
          : await prisma.expenseEntry.deleteMany({ where });
      if (count > 0) removed.push(row);
    } catch (err) {
      errors.push(`Removing ${row.kind} ${row.id}: ${String(err)}`);
    }
  }
  return removed;
}

/**
 * Tells the owner what the deletion pass did: rows removed, or a guard that held them back.
 * A block that hasn't changed since the last push stays quiet. Lock-screen safe: counts only.
 * @param plan - The plan this run made.
 * @param removed - Rows actually removed.
 */
async function notifyDeletionOutcome(
  plan: SheetDeletionPlan,
  removed: readonly LinkedLedgerRow[],
): Promise<void> {
  if (removed.length > 0) {
    const n = removed.length;
    await sendOwnerPush({
      title: `${n} ${n === 1 ? "row" : "rows"} removed from the books`,
      body: `${n === 1 ? "It was" : "They were"} deleted in the Sheet, so the site's totals now match it.`,
      url: "/admin/business",
      tag: "sheets-deleted",
    });
  }
  // An unreadable workbook already fails the cron run, so it doesn't push as well.
  if (plan.status !== "blocked" || plan.block === "unreadable" || plan.candidates.length === 0) {
    if ((await readSettingValue(DELETION_BLOCK_PUSHED_KEY)) !== null) {
      await prisma.setting.deleteMany({ where: { key: DELETION_BLOCK_PUSHED_KEY } });
    }
    return;
  }
  const fingerprint = JSON.stringify([plan.reason, plan.candidates.map((r) => r.id).sort()]);
  if ((await readSettingValue(DELETION_BLOCK_PUSHED_KEY)) === fingerprint) return;
  const n = plan.candidates.length;
  await sendOwnerPush({
    title: "Sheet deletions held back",
    body: `${n} site ${n === 1 ? "row is" : "rows are"} missing from the Sheet but weren't removed: ${plan.reason}. Check the Sheet.`,
    url: "/admin/business",
    tag: "sheets-deletion-blocked",
  });
  await writeSettingValue(DELETION_BLOCK_PUSHED_KEY, fingerprint);
}

/**
 * Reconciles every spreadsheet in the Drive folder (else `GOOGLE_SHEET_ID`) with the DB. Real
 * runs take a lock and self-heal failed appends. Workbooks are read all together or not at
 * all: when none changed since the last clean read (and one ran in the last day) the run
 * reads nothing, otherwise it reads every one, so the deletion pass always sees every Sync
 * ID. A dry run reads everything and reports the deletions it would make.
 * @param dryRun - When true, counts what would change without writing anywhere.
 * @returns Aggregate counts plus a per-spreadsheet breakdown and the deletion report.
 */
export async function runSheetsImport(dryRun: boolean): Promise<ImportResult> {
  const zero = {
    incomeImported: 0,
    incomeUpdated: 0,
    incomeSkipped: 0,
    expensesImported: 0,
    expensesUpdated: 0,
    expensesSkipped: 0,
  };

  if (!dryRun && !(await acquireRunLock(LOCK_KEY))) {
    return { ok: false, locked: true, ...zero, errors: ["Another sync run holds the lock"] };
  }

  try {
    // Dedup maps hold only unlinked rows: a synced entry matching by value is a real second one.
    const [incomeRows, expenseRows, gst] = await Promise.all([
      prisma.incomeEntry.findMany(),
      prisma.expenseEntry.findMany(),
      loadGstStatus(),
    ]);
    const state: SyncState = {
      incomeByKey: new Map(),
      incomeByDedup: new Map(),
      expenseByKey: new Map(),
      expenseByDedup: new Map(),
      seenSyncIds: new Set(),
      partialSyncIds: new Set(),
      gst,
    };
    for (const r of incomeRows) {
      if (r.sheetRowKey) state.incomeByKey.set(r.sheetRowKey, r);
      else {
        const key = dedupKey(r.date, r.amount, r.description);
        if (!state.incomeByDedup.has(key)) state.incomeByDedup.set(key, r);
      }
    }
    for (const r of expenseRows) {
      if (r.sheetRowKey) state.expenseByKey.set(r.sheetRowKey, r);
      else {
        const key = dedupKey(r.date, r.amountIncl, r.description);
        if (!state.expenseByDedup.has(key)) state.expenseByDedup.set(key, r);
      }
    }
    // Snapshot before any Sheet is read: rows the import creates or links this run are
    // seen by construction, so only rows already linked can come up as deleted.
    const linkedAtStart = linkedRowsFrom(state);

    const folderId = process.env.GOOGLE_BUSINESS_SHEETS_FOLDER_ID?.trim();
    const warnings: string[] = [];
    let result: ImportResult;
    let scanComplete = true;
    let readEverything = true;
    let unreadableSheets = 0;
    const emptyWorkbooks: string[] = [];

    if (folderId) {
      const allSheets = await listSpreadsheetsInFolder(folderId);
      /**
       * Whether a workbook is retired ("old..."): it duplicates its replacement's
       * transactions, so it's never imported, but its Sync IDs still count as seen.
       * @param name - The workbook's "folder / file" breadcrumb.
       * @returns True for a retired workbook.
       */
      const isRetired = (name: string): boolean =>
        (name.split(" / ").pop() ?? name).toLowerCase().startsWith("old");
      const sheetsToImport = allSheets.filter((s) => !isRetired(s.name));
      const retiredSheets = allSheets.filter((s) => isRetired(s.name));

      // Read everything, or nothing when no workbook changed and a full read ran recently.
      const lastSeen = dryRun ? {} : await readWorkbookMtimes();
      const lastFullScan = dryRun ? null : await readSettingValue(LAST_FULL_SCAN_KEY);
      const anyChanged = sheetsToImport.some(
        (s) => s.modifiedTime === null || lastSeen[s.fileId] !== s.modifiedTime,
      );
      // NaN (never ran, or an unreadable mark) fails the comparison, so it counts as due.
      const sinceFullScan = Date.now() - (lastFullScan ? Date.parse(lastFullScan) : NaN);
      const fullScanDue = !(sinceFullScan <= FULL_SCAN_EVERY_MS);
      readEverything = dryRun || anyChanged || fullScanDue;

      const seenNow: Record<string, string> = {};
      const aggregate = { ...zero, errors: [] as string[] };
      const perSheet: PerSheetCounts[] = [];

      for (const sheet of readEverything ? sheetsToImport : []) {
        try {
          const counts = await importFromSheet(sheet.fileId, dryRun, state);
          if (sheet.modifiedTime !== null) seenNow[sheet.fileId] = sheet.modifiedTime;
          aggregate.incomeImported += counts.incomeImported;
          aggregate.incomeUpdated += counts.incomeUpdated;
          aggregate.incomeSkipped += counts.incomeSkipped;
          aggregate.expensesImported += counts.expensesImported;
          aggregate.expensesUpdated += counts.expensesUpdated;
          aggregate.expensesSkipped += counts.expensesSkipped;
          aggregate.errors.push(...counts.errors.map((e) => `[${sheet.name}] ${e}`));
          if (counts.empty) emptyWorkbooks.push(sheet.name);
          perSheet.push({ fileId: sheet.fileId, name: sheet.name, ...counts });
        } catch (err) {
          scanComplete = false;
          unreadableSheets++;
          const message = `[${sheet.name}] ${String(err)}`;
          aggregate.errors.push(message);
          perSheet.push({
            fileId: sheet.fileId,
            name: sheet.name,
            ...zero,
            empty: false,
            errors: [message],
          });
        }
      }
      if (readEverything) {
        for (const sheet of retiredSheets) {
          try {
            for (const id of await readRetiredSyncIds(sheet.fileId)) state.seenSyncIds.add(id);
          } catch (err) {
            scanComplete = false;
            aggregate.errors.push(`[${sheet.name}] retired workbook unreadable: ${String(err)}`);
          }
        }
      }

      // A run that read nothing leaves the marks as they were.
      if (!dryRun && readEverything) {
        await writeWorkbookMtimes(seenNow);
        if (scanComplete) {
          await writeSettingValue(LAST_FULL_SCAN_KEY, new Date().toISOString());
        }
      }
      result = { ok: true, source: "folder", perSheet, unreadableSheets, ...aggregate };
    } else {
      const counts = await importFromSheet(getSheetId(), dryRun, state);
      if (counts.empty) emptyWorkbooks.push("GOOGLE_SHEET_ID");
      result = { ok: true, source: "single", ...counts };
    }

    if (!dryRun) result.healed = await healUnsyncedEntries(warnings, result.errors);

    // Deletion pass: only a run that read every workbook can tell a deleted row from an unread one.
    if (readEverything) {
      const plan = planSheetDeletions({
        linked: linkedAtStart,
        seen: state.seenSyncIds,
        partial: state.partialSyncIds,
        scanComplete,
        emptyWorkbooks,
        now: new Date(),
      });
      const held = plan.held.map((h) => reportRow(h.row, h.reason));
      if (plan.status === "blocked") {
        result.deletions = {
          status: "blocked",
          reason: plan.reason,
          rows: plan.candidates.map((r) => reportRow(r)),
          held,
        };
        warnings.push(
          `Sheet deletions held back (${plan.reason}): ${plan.candidates.map(describeLedgerRow).join("; ")}`,
        );
        if (!dryRun) await notifyDeletionOutcome(plan, []);
      } else if (dryRun) {
        result.deletions = {
          status: "dry-run",
          rows: plan.toDelete.map((r) => reportRow(r)),
          held,
        };
      } else {
        const removed = await applySheetDeletions(plan.toDelete, result.errors);
        result.deletions = { status: "applied", rows: removed.map((r) => reportRow(r)), held };
        if (removed.length > 0) {
          console.info(
            `[sheets-import] Removed ${removed.length} row(s) deleted in the Sheet: ${removed.map(describeLedgerRow).join("; ")}`,
          );
        }
        await notifyDeletionOutcome(plan, removed);
      }
      for (const h of plan.held) {
        warnings.push(
          `${describeLedgerRow(h.row)} is missing from the Sheet but was left in place (${h.reason === "recent" ? "written in the last two hours" : "its Sheet row is half-filled"})`,
        );
      }
    } else {
      result.deletions = { status: "skipped", rows: [], held: [] };
    }

    if (warnings.length > 0) {
      result.warnings = warnings;
      console.warn(`[sheets-import] ${warnings.length} warnings:`, warnings);
    }
    return result;
  } finally {
    if (!dryRun) await releaseRunLock(LOCK_KEY);
  }
}
