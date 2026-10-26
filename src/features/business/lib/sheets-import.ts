// src/features/business/lib/sheets-import.ts
// Sheet > site reconciliation for the Cashbook and Expenses tabs; the sheet wins, joined on the
// column-Z Sync ID. Also self-heals entries whose sheet append failed, under a Setting lock.
import { calcGstFromInclusive } from "@/features/business/lib/business";
import { listSpreadsheetsInFolder } from "@/features/business/lib/google-drive";
import { withRetry } from "@/features/business/lib/google-retry";
import { getSheetId, getSheetsClient } from "@/features/business/lib/google-sheets";
import {
  appendRowWithSyncId,
  backfillSyncIds,
  buildCashbookCells,
  buildExpenseCells,
  resolveSheetIdForDate,
} from "@/features/business/lib/sheets-sync";
import { parseObjectId } from "@/features/business/lib/validation";
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
 * @returns GST rate as a decimal (e.g. 0.15).
 */
function parseGstRate(raw: string): number {
  const t = raw.trim();
  if (t.endsWith("%")) {
    const n = parseFloat(t);
    return isNaN(n) ? 0.15 : n / 100;
  }
  const n = parseFloat(t);
  return isNaN(n) ? 0.15 : n > 1 ? n / 100 : n;
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
  errors: string[];
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
      incomeSkipped++;
      continue;
    }
    const customer = (row[1] ?? "").trim();
    const description = (row[2] ?? "").trim();
    const method = (row[3] ?? "").trim();
    const amount = parseAmount(row[4] ?? "");
    const notes = (row[7] ?? "").trim() || null;

    if (!customer || !description || amount === null || amount <= 0) {
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
    const gstRate = parseGstRate(row[7] ?? "15%");
    const notes = (row[10] ?? "").trim() || null;

    if (!supplier || !description || amountIncl === null || amountIncl <= 0) {
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

/**
 * Reconciles every spreadsheet in the Drive folder (else `GOOGLE_SHEET_ID`) with the DB. Real
 * runs take a lock, self-heal failed appends, and warn on linked entries missing a sheet row.
 * @param dryRun - When true, counts what would change without writing anywhere.
 * @returns Aggregate counts plus a per-spreadsheet breakdown.
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
    const [incomeRows, expenseRows] = await Promise.all([
      prisma.incomeEntry.findMany(),
      prisma.expenseEntry.findMany(),
    ]);
    const state: SyncState = {
      incomeByKey: new Map(),
      incomeByDedup: new Map(),
      expenseByKey: new Map(),
      expenseByDedup: new Map(),
      seenSyncIds: new Set(),
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

    const folderId = process.env.GOOGLE_BUSINESS_SHEETS_FOLDER_ID?.trim();
    const warnings: string[] = [];
    let result: ImportResult;
    let allSheetsClean = true;
    let unreadableSheets = 0;
    // A scan that skipped workbooks can't tell a deleted row from an archived one.
    let excludedCount = 0;
    let skippedCount = 0;

    if (folderId) {
      const allSheets = await listSpreadsheetsInFolder(folderId);
      // Skip retired "old" workbooks; they duplicate their replacement's transactions.
      const sheetsToImport = allSheets.filter((s) => {
        const fileName = s.name.split(" / ").pop() ?? s.name;
        return !fileName.toLowerCase().startsWith("old");
      });
      excludedCount = allSheets.length - sheetsToImport.length;

      // Skip workbooks Drive says are untouched since the last clean import.
      const lastSeen = dryRun ? {} : await readWorkbookMtimes();
      const seenNow: Record<string, string> = {};

      const aggregate = { ...zero, errors: [] as string[] };
      const perSheet: PerSheetCounts[] = [];

      for (const sheet of sheetsToImport) {
        if (
          !dryRun &&
          sheet.modifiedTime !== null &&
          lastSeen[sheet.fileId] === sheet.modifiedTime
        ) {
          skippedCount++;
          seenNow[sheet.fileId] = sheet.modifiedTime;
          continue;
        }
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
          perSheet.push({ fileId: sheet.fileId, name: sheet.name, ...counts });
        } catch (err) {
          allSheetsClean = false;
          unreadableSheets++;
          const message = `[${sheet.name}] ${String(err)}`;
          aggregate.errors.push(message);
          perSheet.push({ fileId: sheet.fileId, name: sheet.name, ...zero, errors: [message] });
        }
      }

      if (!dryRun) await writeWorkbookMtimes(seenNow);
      result = { ok: true, source: "folder", perSheet, unreadableSheets, ...aggregate };
    } else {
      const counts = await importFromSheet(getSheetId(), dryRun, state);
      result = { ok: true, source: "single", ...counts };
    }

    if (!dryRun) {
      result.healed = await healUnsyncedEntries(warnings, result.errors);

      // Log-only: linked entries missing from every scanned sheet were likely deleted there.
      // Listed only after a full scan, since excluded or skipped workbooks hide archived rows.
      const scanWasComplete = allSheetsClean && excludedCount === 0 && skippedCount === 0;
      const unmatched = [...state.incomeByKey.keys(), ...state.expenseByKey.keys()].filter(
        (key) => !state.seenSyncIds.has(key),
      ).length;

      if (folderId && !scanWasComplete && unmatched > 0) {
        warnings.push(
          `${unmatched} linked row(s) were not seen in this scan, but it did not read every workbook (${excludedCount} retired, ${skippedCount} unchanged since last import). They may be archived rather than deleted - not listing them.`,
        );
      }

      if (folderId && scanWasComplete) {
        for (const [key, entry] of state.incomeByKey) {
          if (!state.seenSyncIds.has(key)) {
            warnings.push(
              `Income ${entry.id} (${entry.description}) is linked to sheet row ${key} but no scanned sheet has it - deleted in the sheet?`,
            );
          }
        }
        for (const [key, entry] of state.expenseByKey) {
          if (!state.seenSyncIds.has(key)) {
            warnings.push(
              `Expense ${entry.id} (${entry.description}) is linked to sheet row ${key} but no scanned sheet has it - deleted in the sheet?`,
            );
          }
        }
      }
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
