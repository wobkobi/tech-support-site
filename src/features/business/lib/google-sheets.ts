// src/features/business/lib/google-sheets.ts
/**
 * @description Google Sheets v4 helpers for the invoice counter. Reads the
 * prefix, financial year, and last-issued number from the SETTINGS tab and
 * writes back the incremented counter. Cell layout matches the current template.
 */
import { withRetry } from "@/features/business/lib/google-retry";
import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";
import { google } from "googleapis";

export interface InvoiceCounterData {
  prefix: string;
  yearCode: string;
  lastNumber: number;
  nextNumber: number;
  nextFormatted: string;
}

/**
 * Returns an authenticated Google Sheets v4 client.
 * @returns Sheets client instance
 */
export function getSheetsClient(): ReturnType<typeof google.sheets> {
  return google.sheets({ version: "v4", auth: getOAuth2Client() });
}

/**
 * Returns the Google Sheet ID from environment, throwing if unset.
 * @returns Sheet ID string
 */
export function getSheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID is not set");
  return id;
}

/**
 * Reads the current invoice counter state from the Google Sheet SETTINGS tab.
 * Cell layout (current template):
 *   - B8: Invoice Prefix (e.g. "TTP")
 *   - B11: Financial Year (e.g. "2026-27")
 *   - B19: Invoice counter (last issued number; blank = 0)
 * @returns Invoice counter data including next formatted number
 */
export async function getInvoiceCounter(): Promise<InvoiceCounterData> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();
  const res = await withRetry(
    () =>
      sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: ["SETTINGS!B8", "SETTINGS!B11", "SETTINGS!B19"],
      }),
    { label: "invoice-counter-read" },
  );
  const ranges = res.data.valueRanges ?? [];
  const prefix = (ranges[0]?.values?.[0]?.[0] as string | undefined) ?? "TTP";
  const yearRaw = ((ranges[1]?.values?.[0]?.[0] as string | undefined) ?? "").trim();
  const lastRaw = ranges[2]?.values?.[0]?.[0];
  const yearCode = yearRaw.replace("-", "");
  // Guard against manually-mistyped SETTINGS cells (a blank B11, a "#REF!"
  // error, or a stray non-numeric B19). Throwing here hands off to the Prisma
  // fallback in getNextInvoiceNumber rather than minting a poisoned number like
  // "TTP--0001" or "TTP-...-0NaN" that would then be written back to the sheet.
  if (!/^\d{4,6}$/.test(yearCode)) {
    throw new Error(`Invoice counter: SETTINGS!B11 financial year is malformed ("${yearRaw}")`);
  }
  const lastNumber =
    lastRaw != null && String(lastRaw).trim() !== "" ? parseInt(String(lastRaw), 10) : 0;
  if (!Number.isInteger(lastNumber) || lastNumber < 0) {
    throw new Error(`Invoice counter: SETTINGS!B19 is not a valid number ("${String(lastRaw)}")`);
  }
  const nextNumber = lastNumber + 1;
  const nextFormatted = `${prefix}-${yearCode}-${String(nextNumber).padStart(4, "0")}`;
  return { prefix, yearCode, lastNumber, nextNumber, nextFormatted };
}

export interface QuoteCounterData {
  yearCode: string;
  lastNumber: number;
  nextNumber: number;
  nextFormatted: string;
}

/**
 * Reads the quote counter state from the SETTINGS tab. Quotes number from
 * their own cell (B12) so they never consume the invoice counter; the format
 * is `Q-{yearCode}-{NNNN}` (no operator prefix - "Q" IS the prefix).
 * Cell layout (current template):
 *   - B11: Financial Year (shared with the invoice counter)
 *   - B12: Quote counter (last issued number; blank = 0)
 * @returns Quote counter data including next formatted number
 */
export async function getQuoteCounter(): Promise<QuoteCounterData> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();
  const res = await withRetry(
    () =>
      sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: ["SETTINGS!B11", "SETTINGS!B12"],
      }),
    { label: "quote-counter-read" },
  );
  const ranges = res.data.valueRanges ?? [];
  const yearRaw = ((ranges[0]?.values?.[0]?.[0] as string | undefined) ?? "").trim();
  const lastRaw = ranges[1]?.values?.[0]?.[0];
  const yearCode = yearRaw.replace("-", "");
  // Same malformed-cell guards as the invoice counter: throwing hands off to
  // the DB-max fallback instead of minting a poisoned number.
  if (!/^\d{4,6}$/.test(yearCode)) {
    throw new Error(`Quote counter: SETTINGS!B11 financial year is malformed ("${yearRaw}")`);
  }
  const lastNumber =
    lastRaw != null && String(lastRaw).trim() !== "" ? parseInt(String(lastRaw), 10) : 0;
  if (!Number.isInteger(lastNumber) || lastNumber < 0) {
    throw new Error(`Quote counter: SETTINGS!B12 is not a valid number ("${String(lastRaw)}")`);
  }
  const nextNumber = lastNumber + 1;
  const nextFormatted = `Q-${yearCode}-${String(nextNumber).padStart(4, "0")}`;
  return { yearCode, lastNumber, nextNumber, nextFormatted };
}

/**
 * Writes a new quote count back to the SETTINGS tab at B12.
 * @param newCount - The new quote count to persist
 */
export async function setQuoteCounter(newCount: number): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();
  await withRetry(
    () =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "SETTINGS!B12",
        valueInputOption: "RAW",
        requestBody: { values: [[newCount]] },
      }),
    { label: "quote-counter-write" },
  );
}

/**
 * Writes a new invoice count back to the Google Sheet SETTINGS tab at B19.
 * @param newCount - The new invoice count to persist
 */
export async function setInvoiceCounter(newCount: number): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();
  await withRetry(
    () =>
      sheets.spreadsheets.values.update({
        spreadsheetId,
        range: "SETTINGS!B19",
        valueInputOption: "RAW",
        requestBody: { values: [[newCount]] },
      }),
    { label: "invoice-counter-write" },
  );
}
