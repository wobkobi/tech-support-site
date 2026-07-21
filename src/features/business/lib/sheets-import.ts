// src/features/business/lib/sheets-import.ts
// Sheet > site reconciliation for the Cashbook (income) and Expenses tabs. The
// sheet is the source of truth: rows match DB entries by the hidden column-Z
// Sync ID, differing fields update the DB, unmatched rows are (re)created, and
// manually-typed rows get a Sync ID backfilled. runSheetsImport also self-heals
// site entries whose sheet append failed, and takes a Setting-backed lock so
// overlapping runs cannot double-write.
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
import { prisma } from "@/shared/lib/prisma";
import type { ExpenseEntry, IncomeEntry } from "@prisma/client";
import { randomUUID } from "crypto";

/** Setting key for the run lock shared by the cron and the manual import. */
const LOCK_KEY = "sync-sheets-lock";

/** A lock older than this is considered stale (crashed run) and is stolen. */
const LOCK_TTL_MS = 10 * 60_000;

/** Column Z (0-indexed 25) carries the Sync ID; must match sheets-sync.ts. */
const SYNC_ID_COLUMN_INDEX = 25;

/** Site entries younger than this with no sheet row are self-heal appended. */
const SELF_HEAL_MAX_AGE_MS = 24 * 60 * 60_000;

/**
 * Parses a raw date string in DD/MM/YYYY, YYYY-MM-DD, or JS Date format.
 * @param raw - Raw cell value from the sheet.
 * @returns Parsed Date, or null if not a valid date.
 */
function parseDate(raw: string): Date | null {
  const t = raw.trim();
  const dmy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const d = new Date(`${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`);
    return isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

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

export interface PerSheetCounts {
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
  errors: string[];
  /** Non-fatal anomalies: unlinked legacy rows, sheet rows gone missing, etc. */
  warnings?: string[];
  /** Per-spreadsheet breakdown when scanning a Drive folder. */
  perSheet?: PerSheetCounts[];
  /** Source mode used: "folder" when scanning, "single" when falling back to GOOGLE_SHEET_ID. */
  source?: "folder" | "single";
}

/**
 * In-memory view of the DB ledgers, shared across every sheet in one run so
 * per-row findFirst queries are unnecessary and cross-sheet duplicate Sync IDs
 * are visible. Dedup maps hold only rows with no sheetRowKey yet (the legacy
 * pre-Sync-ID guard); entries are consumed as they get linked.
 */
interface SyncState {
  incomeByKey: Map<string, IncomeEntry>;
  incomeByDedup: Map<string, IncomeEntry>;
  expenseByKey: Map<string, ExpenseEntry>;
  expenseByDedup: Map<string, ExpenseEntry>;
  /** Every Sync ID observed (or minted) in the scanned sheets this run. */
  seenSyncIds: Set<string>;
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
 * True when any sheet-owned income field differs between the DB row and the
 * parsed sheet row.
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
 * True when any sheet-owned expense field differs between the DB row and the
 * parsed sheet row.
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

/** 24-hex Mongo ObjectId shape - guards live findUnique({ id }) against legacy UUID Sync IDs. */
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

/**
 * Whether two money amounts differ by at least a cent. Both are rounded to
 * cents first so float representation drift and the GST percent integer
 * round-trip don't flag a spurious diff that rewrites the DB every hour.
 * @param a - First amount.
 * @param b - Second amount.
 * @returns True when they round to different cents.
 */
function amountDiffers(a: number, b: number): boolean {
  return Math.round(a * 100) !== Math.round(b * 100);
}

/**
 * Reconciles the Cashbook and Expenses tabs of a single spreadsheet against
 * the DB, with the sheet winning conflicts. Matching is by column-Z Sync ID;
 * rows without one fall back to the legacy (date+amount+description) guard and
 * get a Sync ID backfilled in one batched write per tab. Row-level errors are
 * captured and do not abort the run.
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
    const row = cashRows[i];
    const date = parseDate(row[0] ?? "");
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
        // A duplicate Sync ID within this run is a copy-pasted sheet row. If the
        // second row's data matches the first, it's a machine copy (a retried
        // append, or an unedited paste) and skipping avoids double-counting. If
        // it differs materially, it's a real second transaction that copied the
        // hidden id - mint a fresh id and import it.
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
          // No snapshot match. The snapshot is taken at run start, so an entry
          // created mid-run (e.g. an invoice /pay whose sheet row carries the
          // entry id as its Sync ID) is invisible here. Look it up live by id
          // before creating a DUPLICATE - a deterministic Sync ID equals the
          // entry's Mongo id, so a hit means "already recorded - just link it".
          // Gate on the ObjectId shape; a legacy UUID would throw on findUnique.
          const idLink = OBJECT_ID_RE.test(syncId)
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
    const row = expRows[i];
    const date = parseDate(row[0] ?? "");
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

    // Derived columns I/J are never trusted from the sheet; recompute the GST
    // split from the inclusive amount and the sheet's rate.
    const gstAmount = calcGstFromInclusive(amountIncl, gstRate);
    const amountExcl = Math.round((amountIncl - gstAmount) * 100) / 100;
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
          // Live id-fallback link before creating a duplicate - see the income
          // loop above for the full rationale.
          const idLink = OBJECT_ID_RE.test(syncId)
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

  // Flush Sync ID backfills in one batched write per tab. Safe against row
  // shift: the loops above never insert or delete rows, so the indices from
  // the initial batchGet are still valid.
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
 * Attempts to take the run lock; a lock older than {@link LOCK_TTL_MS} is
 * treated as left behind by a crashed run and stolen.
 * @returns True when the lock was acquired.
 */
async function acquireSyncLock(): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const staleThreshold = new Date(Date.now() - LOCK_TTL_MS).toISOString();
  // Compare-and-set: atomically steal a stale lock. The value is an ISO
  // timestamp, which sorts chronologically, so `value < staleThreshold` means
  // older than the TTL. updateMany is a single atomic op per document, so two
  // concurrent runs can't both match - after the first stamps `nowIso`, the
  // row no longer satisfies the second's stale filter.
  const stolen = await prisma.setting.updateMany({
    where: { key: LOCK_KEY, value: { lt: staleThreshold } },
    data: { value: nowIso },
  });
  if (stolen.count === 1) return true;
  // Nothing stale to steal: either a fresh lock holds it, or no lock exists.
  // Try to create the row - the unique `key` index makes concurrent creates
  // race-safe (only one wins; the loser throws and returns false).
  try {
    await prisma.setting.create({ data: { key: LOCK_KEY, value: nowIso } });
    return true;
  } catch {
    return false;
  }
}

/** Releases the run lock. Never throws - a leftover lock expires via TTL. */
async function releaseSyncLock(): Promise<void> {
  try {
    await prisma.setting.deleteMany({ where: { key: LOCK_KEY } });
  } catch (err) {
    console.warn("[sheets-import] Failed to release sync lock:", err);
  }
}

/**
 * Appends site entries that never made it to a sheet (append failed at create
 * time). Only entries younger than {@link SELF_HEAL_MAX_AGE_MS} are appended -
 * older unlinked rows predate the Sync ID rollout or reflect sheet-side
 * deletions, and are surfaced as warnings instead of being pushed back into
 * the ledger the operator may have deliberately cleaned.
 * @param warnings - Run-level warning sink.
 * @param errors - Run-level error sink.
 * @returns Number of entries healed.
 */
async function healUnsyncedEntries(warnings: string[], errors: string[]): Promise<number> {
  let healed = 0;
  const cutoff = new Date(Date.now() - SELF_HEAL_MAX_AGE_MS);

  const [incomeOrphans, expenseOrphans] = await Promise.all([
    prisma.incomeEntry.findMany({ where: { sheetRowKey: null } }),
    prisma.expenseEntry.findMany({ where: { sheetRowKey: null } }),
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
      const sheetRowKey = await appendRowWithSyncId(
        spreadsheetId,
        "Cashbook",
        buildCashbookCells(entry),
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
      const sheetRowKey = await appendRowWithSyncId(
        spreadsheetId,
        "Expenses",
        buildExpenseCells(entry),
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
 * Reconciles every spreadsheet with the DB (sheet wins). When
 * `GOOGLE_BUSINESS_SHEETS_FOLDER_ID` is set, scans that Drive folder and
 * processes every spreadsheet inside (one per financial year); otherwise falls
 * back to `GOOGLE_SHEET_ID` only. Real runs take a lock so the hourly cron and
 * a manual import cannot overlap, then self-heal entries whose sheet append
 * failed, and log-only verify that every linked DB entry still has a sheet row.
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

  if (!dryRun && !(await acquireSyncLock())) {
    return { ok: false, locked: true, ...zero, errors: ["Another sync run holds the lock"] };
  }

  try {
    // One DB read up front instead of a findFirst per sheet row. The dedup
    // maps deliberately hold only unlinked rows: a synced entry matching a
    // manual row by value is a genuine second transaction, not a duplicate.
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

    if (folderId) {
      // Retired workbooks prefixed "old" stay in the folder for reference but
      // must not sync - they duplicate the replacement workbook's transactions,
      // so importing both double-counts the ledger.
      const sheetsToImport = (await listSpreadsheetsInFolder(folderId)).filter((s) => {
        const fileName = s.name.split(" / ").pop() ?? s.name;
        return !fileName.toLowerCase().startsWith("old");
      });
      const aggregate = { ...zero, errors: [] as string[] };
      const perSheet: PerSheetCounts[] = [];

      for (const sheet of sheetsToImport) {
        try {
          const counts = await importFromSheet(sheet.fileId, dryRun, state);
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
          const message = `[${sheet.name}] ${String(err)}`;
          aggregate.errors.push(message);
          perSheet.push({ fileId: sheet.fileId, name: sheet.name, ...zero, errors: [message] });
        }
      }

      result = { ok: true, source: "folder", perSheet, ...aggregate };
    } else {
      const counts = await importFromSheet(getSheetId(), dryRun, state);
      result = { ok: true, source: "single", ...counts };
    }

    if (!dryRun) {
      result.healed = await healUnsyncedEntries(warnings, result.errors);

      // Log-only existence check: a linked DB entry whose Sync ID appeared in
      // no scanned sheet means its row was deleted sheet-side. Under
      // sheet-wins that entry should go too, but auto-deleting on a partial
      // scan would be destructive - so surface it and leave the decision to
      // the operator. Skipped when any sheet failed to load (folder mode) or
      // when only one workbook was scanned (single mode misses other FYs).
      if (folderId && allSheetsClean) {
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
    if (!dryRun) await releaseSyncLock();
  }
}
