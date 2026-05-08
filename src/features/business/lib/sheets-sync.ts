// src/features/business/lib/sheets-sync.ts
/**
 * @file sheets-sync.ts
 * @description Site → Google Sheet write-back helpers. Each cashbook/expense
 * entry created via the site appends a row to the per-FY spreadsheet (resolved
 * by walking `Business/<FY-name>/...` in Drive). A hidden `Sync ID` column at
 * column Z carries a stable UUID so future edit/delete sync can find rows
 * regardless of reorders or content changes.
 *
 * Failures are non-fatal: callers should log but never block on sheet writes.
 */

import { randomUUID } from "crypto";
import { getSheetsClient } from "@/features/business/lib/google-sheets";
import { getDriveClient } from "@/features/business/lib/google-drive";
import { getFinancialYear } from "@/features/business/lib/financial-year";

/** Cache: FY key (e.g. "2025-26") → spreadsheet file ID. */
const fySheetCache = new Map<string, string>();

/** Cache: spreadsheet file ID → Set of tab names that have already had Sync ID setup applied. */
const setupCache = new Map<string, Set<string>>();

/** Column Z (0-indexed 25) is where the Sync ID lives, well clear of any data column. */
const SYNC_ID_COLUMN_INDEX = 25;
const SYNC_ID_COLUMN_LETTER = "Z";

/**
 * Resolves the spreadsheet file ID for the financial year that contains `date`.
 * Walks the configured `GOOGLE_BUSINESS_SHEETS_FOLDER_ID` looking for a
 * subfolder named like the FY (e.g. `2025-26`) and returns the first
 * spreadsheet inside it. Results are cached per-process.
 * @param date - Entry date used to compute the FY.
 * @returns Spreadsheet file ID, or null if no matching folder/sheet was found.
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
  const escapedKey = fyKey.replace(/'/g, "\\'");

  const folderRes = await drive.files.list({
    q: `'${folderId}' in parents and name='${escapedKey}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: "files(id)",
    pageSize: 1,
  });
  const fyFolderId = folderRes.data.files?.[0]?.id;
  if (!fyFolderId) return null;

  const sheetRes = await drive.files.list({
    q: `'${fyFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: "files(id)",
    pageSize: 1,
  });
  const sheetId = sheetRes.data.files?.[0]?.id;
  if (!sheetId) return null;

  fySheetCache.set(fyKey, sheetId);
  return sheetId;
}

/**
 * Looks up the numeric sheet ID (gid) of a tab by name. Required because the
 * batchUpdate API addresses sheets by gid, not by name.
 * @param spreadsheetId - The spreadsheet file ID.
 * @param tabName - Human-readable tab name (e.g. "Cashbook").
 * @returns The numeric sheetId, or null if the tab is missing.
 */
async function getTabSheetId(spreadsheetId: string, tabName: string): Promise<number | null> {
  const sheets = getSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const tab = meta.data.sheets?.find((s) => s.properties?.title === tabName);
  return tab?.properties?.sheetId ?? null;
}

/**
 * Idempotently prepares the Sync ID column on a tab: writes the "Sync ID"
 * header at Z1 (if missing), hides the column, and adds a warning-only
 * protected range so the column can't be edited accidentally via the UI.
 * Cached per-process so repeat calls are free after the first.
 * @param spreadsheetId - The spreadsheet file ID.
 * @param tabName - Tab to prepare (e.g. "Cashbook" or "Expenses").
 */
export async function ensureSyncIdSetup(spreadsheetId: string, tabName: string): Promise<void> {
  const cached = setupCache.get(spreadsheetId);
  if (cached?.has(tabName)) return;

  const sheets = getSheetsClient();

  // Read Z1 to see whether setup has already been done in a previous run.
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!${SYNC_ID_COLUMN_LETTER}1`,
  });
  const existingHeader = headerRes.data.values?.[0]?.[0];
  if (existingHeader === "Sync ID") {
    // Already set up; trust the previous run for hidden+protected state.
    if (!cached) setupCache.set(spreadsheetId, new Set([tabName]));
    else cached.add(tabName);
    return;
  }

  // First-time setup for this tab: write header, hide column, add protection.
  const tabSheetId = await getTabSheetId(spreadsheetId, tabName);
  if (tabSheetId === null) {
    throw new Error(`Tab "${tabName}" not found in spreadsheet ${spreadsheetId}`);
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!${SYNC_ID_COLUMN_LETTER}1`,
    valueInputOption: "RAW",
    requestBody: { values: [["Sync ID"]] },
  });

  await sheets.spreadsheets.batchUpdate({
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
              warningOnly: true,
            },
          },
        },
      ],
    },
  });

  if (!cached) setupCache.set(spreadsheetId, new Set([tabName]));
  else cached.add(tabName);
}

/**
 * Appends a row to a tab with a fresh Sync ID at column Z.
 * Pads `cells` to 25 columns so column Z always lands at index 25.
 * @param spreadsheetId - Spreadsheet file ID.
 * @param tabName - Tab to append to (e.g. "Cashbook").
 * @param cells - Values for columns A..Y (0..24). Shorter arrays are right-padded with empty strings.
 * @returns The Sync ID written into column Z, suitable for storing on the DB entry.
 */
export async function appendRowWithSyncId(
  spreadsheetId: string,
  tabName: string,
  cells: (string | number | null)[],
): Promise<string> {
  await ensureSyncIdSetup(spreadsheetId, tabName);
  const syncId = randomUUID();
  const padded: (string | number | null)[] = cells.slice(0, SYNC_ID_COLUMN_INDEX);
  while (padded.length < SYNC_ID_COLUMN_INDEX) padded.push("");
  padded.push(syncId);

  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${tabName}!A:${SYNC_ID_COLUMN_LETTER}`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [padded] },
  });

  return syncId;
}

/**
 * Formats a Date as DD/MM/YYYY (NZ display format) for sheet output.
 * @param d - Date to format.
 * @returns Date string like "30/03/2026".
 */
export function formatDateForSheet(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}
