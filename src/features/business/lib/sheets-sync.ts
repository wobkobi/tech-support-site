// src/features/business/lib/sheets-sync.ts
/**
 * @file sheets-sync.ts
 * @description Site → Google Sheet write-back. Hidden Sync ID at column Z
 * carries a UUID so edits/deletes can find rows. Failures are non-fatal.
 */

import { randomUUID } from "crypto";
import { getSheetsClient } from "@/features/business/lib/google-sheets";
import { getDriveClient } from "@/features/business/lib/google-drive";
import { formatDateSlash } from "@/shared/lib/date-format";
import { getFinancialYear } from "@/features/business/lib/financial-year";

/** Cache: FY key (e.g. "2025-26") → spreadsheet file ID. */
const fySheetCache = new Map<string, string>();

/** Cache: spreadsheet file ID → Set of tab names that have already had Sync ID setup applied. */
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
 * Looks up the numeric sheet ID (gid) of a tab by name; needed for batchUpdate.
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
 * Idempotently writes the Z1 "Sync ID" header, hides the column, and protects it.
 * @param spreadsheetId - The spreadsheet file ID.
 * @param tabName - Tab to prepare (e.g. "Cashbook" or "Expenses").
 */
export async function ensureSyncIdSetup(spreadsheetId: string, tabName: string): Promise<void> {
  const cached = setupCache.get(spreadsheetId);
  if (cached?.has(tabName)) return;

  const sheets = getSheetsClient();

  // Z1 set means a previous run did the setup.
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!${SYNC_ID_COLUMN_LETTER}1`,
  });
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
 * Appends a row with a fresh Sync ID at column Z; pads to 25 columns.
 * @param spreadsheetId - Spreadsheet file ID.
 * @param tabName - Tab to append to (e.g. "Cashbook").
 * @param cells - Values for columns A..Y; right-padded with empty strings.
 * @returns The Sync ID written into column Z.
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
 * Sheet-bound DD/MM/YYYY string (UTC date parts).
 * @param d - Date to format.
 * @returns Formatted string.
 */
export function formatDateForSheet(d: Date): string {
  return formatDateSlash(d, { utc: true });
}
