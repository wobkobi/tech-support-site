// src/features/business/lib/google-sheets.ts
// Google Sheets v4 helpers for the invoice and quote counters on the SETTINGS tab.

import { withRetry } from "@/features/business/lib/google-retry";
import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";
import { sheets as googleSheets, type sheets_v4 } from "@googleapis/sheets";

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
export function getSheetsClient(): sheets_v4.Sheets {
  return googleSheets({ version: "v4", auth: getOAuth2Client() });
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
 * Reads the invoice counter from SETTINGS: B8 prefix ("TTP"), B11 financial year ("2026-27"),
 * B19 last issued number (blank = 0).
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
  // Throw on mistyped cells so getNextInvoiceNumber falls back to Prisma, not "TTP--0001".
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
 * Reads the quote counter (`Q-{yearCode}-{NNNN}`) from SETTINGS: B11 financial year (shared),
 * B12 last issued number (blank = 0), separate from the invoice counter.
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
  // Throw on mistyped cells so the caller falls back to the DB max.
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
