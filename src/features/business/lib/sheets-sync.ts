// src/features/business/lib/sheets-sync.ts
/**
 * @description Site > Google Sheet write-back primitives. Hidden Sync ID at
 * column Z carries a UUID so appends, in-place updates, deletes, and the
 * import's reconciliation can all locate rows. Cell builders keep the
 * Cashbook/Expenses column order in one place. Failures are non-fatal.
 */

import { getFinancialYear } from "@/features/business/lib/financial-year";
import { getDriveClient } from "@/features/business/lib/google-drive";
import { withRetry } from "@/features/business/lib/google-retry";
import { getSheetsClient } from "@/features/business/lib/google-sheets";
import { formatDateSlash } from "@/shared/lib/date-format";
import { randomUUID } from "crypto";

/** Cache: FY key (e.g. "2025-26") > spreadsheet file ID. */
const fySheetCache = new Map<string, string>();

/** Cache: spreadsheet file ID > Set of tab names that have already had Sync ID setup applied. */
const setupCache = new Map<string, Set<string>>();

/** Column Z (0-indexed 25) is where the Sync ID lives, well clear of any data column. */
const SYNC_ID_COLUMN_INDEX = 25;
const SYNC_ID_COLUMN_LETTER = "Z";

/**
 * Resolves the FY spreadsheet ID for `date`; cached per-process.
 * @param date - Entry date used to compute the FY.
 * @returns Spreadsheet file ID, or null if not found.
 */
export async function getFySheetIdForDate(date: Date): Promise<string | null> {
  const folderId = process.env.GOOGLE_BUSINESS_SHEETS_FOLDER_ID?.trim();
  if (!folderId) return null;

  const fy = getFinancialYear(date);
  const fyKey = fy.label.match(/(\d{4}-\d{2})/)?.[1];
  if (!fyKey) return null;

  const cached = fySheetCache.get(fyKey);
  if (cached) return cached;

  const drive = getDriveClient();
  const escapedKey = fyKey.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  const folderRes = await withRetry(
    () =>
      drive.files.list({
        q: `'${folderId}' in parents and name='${escapedKey}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id)",
        pageSize: 1,
      }),
    { label: "sheets-sync" },
  );
  const fyFolderId = folderRes.data.files?.[0]?.id;
  if (!fyFolderId) return null;

  const sheetRes = await withRetry(
    () =>
      drive.files.list({
        q: `'${fyFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
        fields: "files(id)",
        pageSize: 1,
      }),
    { label: "sheets-sync" },
  );
  const sheetId = sheetRes.data.files?.[0]?.id;
  if (!sheetId) return null;

  fySheetCache.set(fyKey, sheetId);
  return sheetId;
}

/**
 * Resolves the spreadsheet an entry dated `date` should live in: the per-FY
 * sheet when `GOOGLE_BUSINESS_SHEETS_FOLDER_ID` is set, otherwise the single
 * `GOOGLE_SHEET_ID` workbook. Returns null when neither resolves - callers
 * skip the sheet write and the cron self-heal appends the row later.
 * @param date - Entry date used to pick the FY workbook.
 * @returns Spreadsheet file ID, or null when no destination exists.
 */
export async function resolveSheetIdForDate(date: Date): Promise<string | null> {
  const folderId = process.env.GOOGLE_BUSINESS_SHEETS_FOLDER_ID?.trim();
  if (folderId) return getFySheetIdForDate(date);
  return process.env.GOOGLE_SHEET_ID?.trim() || null;
}

/**
 * Looks up the numeric sheet ID (gid) of a tab by name; needed for batchUpdate.
 * Matching is trimmed and case-insensitive to mirror how the values API
 * resolves range names - the workbooks title their tabs "CASHBOOK"/"EXPENSES"
 * while the code addresses them as "Cashbook"/"Expenses", so an exact match
 * reads rows fine but broke every metadata lookup (Sync-ID backfill).
 * @param spreadsheetId - The spreadsheet file ID.
 * @param tabName - Human-readable tab name (e.g. "Cashbook").
 * @returns The numeric sheetId, or null if the tab is missing.
 */
async function getTabSheetId(spreadsheetId: string, tabName: string): Promise<number | null> {
  const sheets = getSheetsClient();
  const meta = await withRetry(
    () =>
      sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title))",
      }),
    { label: "sheets-sync" },
  );
  const wanted = tabName.trim().toLowerCase();
  const tab = meta.data.sheets?.find((s) => s.properties?.title?.trim().toLowerCase() === wanted);
  if (tab?.properties?.sheetId == null) {
    console.warn(
      `[sheets-sync] Tab "${tabName}" not found in ${spreadsheetId}; tabs: ${(
        meta.data.sheets ?? []
      )
        .map((s) => JSON.stringify(s.properties?.title ?? ""))
        .join(", ")}`,
    );
    return null;
  }
  return tab.properties.sheetId;
}

/**
 * Idempotently writes the Z1 "Sync ID" header, hides the column, and protects it.
 * @param spreadsheetId - The spreadsheet file ID.
 * @param tabName - Tab to prepare (e.g. "Cashbook" or "Expenses").
 */
export async function ensureSyncIdSetup(spreadsheetId: string, tabName: string): Promise<void> {
  const cached = setupCache.get(spreadsheetId);
  if (cached?.has(tabName)) return;

  const sheets = getSheetsClient();

  // Z1 set means a previous run did the setup.
  const headerRes = await withRetry(
    () =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${tabName}!${SYNC_ID_COLUMN_LETTER}1`,
      }),
    { label: "sheets-sync" },
  );
  const existingHeader = headerRes.data.values?.[0]?.[0];
  if (existingHeader === "Sync ID") {
    if (!cached) setupCache.set(spreadsheetId, new Set([tabName]));
    else cached.add(tabName);
    return;
  }

  const tabSheetId = await getTabSheetId(spreadsheetId, tabName);
  if (tabSheetId === null) {
    throw new Error(`Tab "${tabName}" not found in spreadsheet ${spreadsheetId}`);
  }

  await withRetry(
    () =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabName}!${SYNC_ID_COLUMN_LETTER}1`,
        valueInputOption: "RAW",
        requestBody: { values: [["Sync ID"]] },
      }),
    { label: "sheets-sync" },
  );

  await withRetry(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateDimensionProperties: {
              range: {
                sheetId: tabSheetId,
                dimension: "COLUMNS",
                startIndex: SYNC_ID_COLUMN_INDEX,
                endIndex: SYNC_ID_COLUMN_INDEX + 1,
              },
              properties: { hiddenByUser: true },
              fields: "hiddenByUser",
            },
          },
          {
            addProtectedRange: {
              protectedRange: {
                range: {
                  sheetId: tabSheetId,
                  startColumnIndex: SYNC_ID_COLUMN_INDEX,
                  endColumnIndex: SYNC_ID_COLUMN_INDEX + 1,
                },
                description: "Sync ID column - managed by To The Point app",
                // Warning-only so owner-authed row deletes and updates are never
                // blocked; strict protection would 403 deleteDimension calls.
                warningOnly: true,
              },
            },
          },
        ],
      },
    }),
  );

  if (!cached) setupCache.set(spreadsheetId, new Set([tabName]));
  else cached.add(tabName);
}

/**
 * Writes a row (with its Sync ID at column Z) into the first empty-date row,
 * padding to 25 columns. NOT a values.append - see {@link firstEmptyRow} for why
 * the tabs' fill-down formula templates make append strand rows at the grid
 * bottom.
 *
 * When the caller supplies a deterministic Sync ID (an entry's Mongo id), the
 * write is idempotent: if a row already carries that id (a retry after a
 * succeeded-but-unacknowledged write, or a re-persist), the existing id is
 * returned WITHOUT writing a duplicate. Legacy callers pass none and get a fresh
 * random id. The read-then-write is not atomic - live routes don't hold the sync
 * lock - so a concurrent collision is still possible; the import's content-gated
 * dedup and the cron self-heal are the backstops for that.
 * @param spreadsheetId - Spreadsheet file ID.
 * @param tabName - Tab to write to (e.g. "Cashbook").
 * @param cells - Values for columns A..Y; sheet-managed columns pass null to keep their formulas; right-padded with empty strings.
 * @param syncId - Optional caller-supplied deterministic Sync ID; a fresh random one is minted when omitted.
 * @returns The Sync ID written into (or already present in) column Z.
 */
export async function appendRowWithSyncId(
  spreadsheetId: string,
  tabName: string,
  cells: (string | number | null)[],
  syncId?: string,
): Promise<string> {
  await ensureSyncIdSetup(spreadsheetId, tabName);
  const id = syncId ?? randomUUID();
  // Append-if-absent for deterministic ids: reuse an existing row instead of
  // doubling it. Random ids can't collide, so skip the extra read for them.
  if (syncId) {
    const existing = await readSyncIdColumn(spreadsheetId, tabName);
    if (existing.has(syncId)) return syncId;
  }
  const padded: (string | number | null)[] = cells.slice(0, SYNC_ID_COLUMN_INDEX);
  while (padded.length < SYNC_ID_COLUMN_INDEX) padded.push("");
  padded.push(id);

  // Write into the first empty row rather than values.append. The Cashbook /
  // Expenses tabs are 1000-row templates whose sheet-managed formula columns are
  // pre-filled down the whole grid, so values.append (which lands after the last
  // populated cell in ANY searched column) strands new rows near row 1000
  // instead of below the last entry. Targeting the first empty-date row keeps
  // entries contiguous and drops each onto its pre-built formula row; the null
  // cells in `padded` (sheet-managed columns) are skipped by update, so those
  // formulas survive. Sequential writers are safe; a rare concurrent collision
  // orphans one sheetRowKey, which the cron self-heal re-appends later.
  const targetRow = await firstEmptyRow(spreadsheetId, tabName);
  const sheets = getSheetsClient();
  await withRetry(
    () =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabName}!A${targetRow}:${SYNC_ID_COLUMN_LETTER}${targetRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [padded] },
      }),
    { label: "sheets-sync" },
  );

  return id;
}

/**
 * Finds the first data row whose date column (A) is empty - the slot a new entry
 * should fill. The tabs are 1000-row templates with formulas pre-filled below
 * the data, so "first empty date" is the contiguous insert point (values.get
 * trims trailing empties, so a fully-packed block returns its next row). Column
 * A holds only real entry dates - never a fill-down formula - so it pinpoints
 * the insert row regardless of which other column's formulas reach the grid
 * bottom. Rows stranded low by the old append bug sit AFTER a gap, so a
 * first-empty scan skips over them.
 * @param spreadsheetId - Spreadsheet file ID.
 * @param tabName - Tab to scan (e.g. "Cashbook").
 * @returns 1-based row number of the first empty-date row (>= 2).
 */
async function firstEmptyRow(spreadsheetId: string, tabName: string): Promise<number> {
  const sheets = getSheetsClient();
  const res = await withRetry(
    () => sheets.spreadsheets.values.get({ spreadsheetId, range: `${tabName}!A2:A` }),
    { label: "sheets-sync" },
  );
  const rows = res.data.values ?? [];
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i]?.[0];
    if (v == null || String(v).trim() === "") return i + 2;
  }
  return rows.length + 2;
}

/**
 * Sheet-bound DD/MM/YYYY string (UTC date parts).
 * @param d - Date to format.
 * @returns Formatted string.
 */
export function formatDateForSheet(d: Date): string {
  return formatDateSlash(d, { utc: true });
}

/** Subset of an income entry needed to build its Cashbook sheet row. */
export interface CashbookRowInput {
  date: Date;
  customer: string;
  description: string;
  method: string;
  amount: number;
  notes?: string | null;
}

/** Subset of an expense entry needed to build its Expenses sheet row. */
export interface ExpenseRowInput {
  date: Date;
  supplier: string;
  description: string;
  category: string;
  method: string;
  receipt: boolean;
  amountIncl: number;
  gstAmount: number;
  amountExcl: number;
  notes?: string | null;
}

/**
 * Builds the Cashbook cells A..H for an income entry. Columns F (Cash Deposit
 * Ref) and G (Tax Put-Aside) are sheet-managed: null means "skip" in a
 * values.update, so in-place edits never clobber operator-entered values there.
 * @param e - Income entry fields.
 * @returns Cell values for columns A..H.
 */
export function buildCashbookCells(e: CashbookRowInput): (string | number | null)[] {
  return [
    formatDateForSheet(e.date),
    e.customer,
    e.description,
    e.method,
    e.amount,
    null,
    null,
    e.notes ?? "",
  ];
}

/**
 * Builds the Expenses cells A..K for an expense entry. The GST rate (column H)
 * is derived from the stored GST split and written as a percent string (e.g.
 * "15%") to match what the importer's parser reads. Columns I (GST amount) and
 * J (excl-GST amount) are sheet-managed formulas: null means "skip", so the
 * app never overwrites the sheet's own formulas there (which broke the sheet
 * when hard values landed on top of them). The importer recomputes I/J on read
 * anyway, so the DB round-trip is unaffected. Mirrors {@link buildCashbookCells}.
 * @param e - Expense entry fields.
 * @returns Cell values for columns A..K (I/J null so the sheet formulas stand).
 */
export function buildExpenseCells(e: ExpenseRowInput): (string | number | null)[] {
  const gstPct = e.amountExcl > 0 ? Math.round((e.gstAmount / e.amountExcl) * 100) : 0;
  return [
    formatDateForSheet(e.date),
    e.supplier,
    e.description,
    e.category,
    e.method,
    e.receipt ? "Yes" : "No",
    e.amountIncl,
    `${gstPct}%`,
    null,
    null,
    e.notes ?? "",
  ];
}

/**
 * Reads the Sync ID column of a tab into a syncId > 1-based row number map.
 * One API call; use for bulk reconciliation instead of per-row lookups.
 * Row indices are only valid until the next row insert/delete on the tab.
 * @param spreadsheetId - Spreadsheet file ID.
 * @param tabName - Tab to read (e.g. "Cashbook").
 * @returns Map of Sync ID to 1-based row number.
 */
export async function readSyncIdColumn(
  spreadsheetId: string,
  tabName: string,
): Promise<Map<string, number>> {
  const sheets = getSheetsClient();
  const res = await withRetry(
    () =>
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${tabName}!${SYNC_ID_COLUMN_LETTER}:${SYNC_ID_COLUMN_LETTER}`,
        majorDimension: "COLUMNS",
      }),
    { label: "sheets-sync" },
  );
  const column = (res.data.values?.[0] ?? []) as string[];
  const map = new Map<string, number>();
  for (let i = 0; i < column.length; i++) {
    const value = (column[i] ?? "").trim();
    // Z1 holds the "Sync ID" header, never a UUID, so it can't collide.
    if (value) map.set(value, i + 1);
  }
  return map;
}

/**
 * Finds the 1-based row number of the row carrying `syncId` in column Z.
 * @param spreadsheetId - Spreadsheet file ID.
 * @param tabName - Tab to search.
 * @param syncId - Sync ID to locate.
 * @returns 1-based row number, or null when not present.
 */
export async function findRowIndexBySyncId(
  spreadsheetId: string,
  tabName: string,
  syncId: string,
): Promise<number | null> {
  const map = await readSyncIdColumn(spreadsheetId, tabName);
  return map.get(syncId) ?? null;
}

/**
 * Updates the sheet row carrying `syncId` in place (columns A..Y only, so the
 * Sync ID at Z is preserved; null cells are skipped, not cleared). When the row
 * has vanished (operator deleted it), falls back to appending a fresh row so
 * the entry is never lost - the caller must persist the returned key when it
 * differs from the one passed in.
 * @param spreadsheetId - Spreadsheet file ID.
 * @param tabName - Tab holding the row.
 * @param syncId - Sync ID of the row to update.
 * @param cells - New values for columns A..Y (null = leave cell untouched).
 * @returns Whether an in-place update happened, and the row's current Sync ID.
 */
export async function updateRowBySyncId(
  spreadsheetId: string,
  tabName: string,
  syncId: string,
  cells: (string | number | null)[],
): Promise<{ updated: boolean; syncId: string }> {
  const rowIndex = await findRowIndexBySyncId(spreadsheetId, tabName, syncId);
  if (rowIndex === null) {
    // Row vanished (sheet-side delete): re-append under the SAME Sync ID rather
    // than minting a fresh random one, so the caller's persisted sheetRowKey
    // stays valid and the import's id-fallback can re-link an orphan left by a
    // failed re-persist.
    const newSyncId = await appendRowWithSyncId(spreadsheetId, tabName, cells, syncId);
    return { updated: false, syncId: newSyncId };
  }

  const sheets = getSheetsClient();
  await withRetry(
    () =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabName}!A${rowIndex}:Y${rowIndex}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [cells.slice(0, SYNC_ID_COLUMN_INDEX)] },
      }),
    { label: "sheets-sync" },
  );
  return { updated: true, syncId };
}

/**
 * Deletes the whole sheet row carrying `syncId`. deleteDimension shifts the
 * rows below up, so any cached row indices are stale after this call.
 * @param spreadsheetId - Spreadsheet file ID.
 * @param tabName - Tab holding the row.
 * @param syncId - Sync ID of the row to delete.
 * @returns True when a row was found and deleted; false when already gone.
 */
export async function deleteRowBySyncId(
  spreadsheetId: string,
  tabName: string,
  syncId: string,
): Promise<boolean> {
  const rowIndex = await findRowIndexBySyncId(spreadsheetId, tabName, syncId);
  if (rowIndex === null) return false;

  const tabSheetId = await getTabSheetId(spreadsheetId, tabName);
  if (tabSheetId === null) {
    throw new Error(`Tab "${tabName}" not found in spreadsheet ${spreadsheetId}`);
  }

  const sheets = getSheetsClient();
  await withRetry(
    () =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: tabSheetId,
                  dimension: "ROWS",
                  startIndex: rowIndex - 1,
                  endIndex: rowIndex,
                },
              },
            },
          ],
        },
      }),
    { label: "sheets-sync" },
  );
  return true;
}

/**
 * Writes Sync IDs into column Z for existing sheet rows in one batched call.
 * Used by the import to backfill manually-typed rows. Runs {@link ensureSyncIdSetup}
 * first so the header/hidden/protected state exists.
 * @param spreadsheetId - Spreadsheet file ID.
 * @param tabName - Tab to write to.
 * @param backfills - Row numbers (1-based) and the Sync IDs to write.
 */
export async function backfillSyncIds(
  spreadsheetId: string,
  tabName: string,
  backfills: { rowIndex: number; syncId: string }[],
): Promise<void> {
  if (backfills.length === 0) return;
  await ensureSyncIdSetup(spreadsheetId, tabName);
  const sheets = getSheetsClient();
  await withRetry(
    () =>
      sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "RAW",
          data: backfills.map((b) => ({
            range: `${tabName}!${SYNC_ID_COLUMN_LETTER}${b.rowIndex}`,
            values: [[b.syncId]],
          })),
        },
      }),
    { label: "sheets-sync" },
  );
}
