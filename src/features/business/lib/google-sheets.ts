import { google } from "googleapis";
import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";

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
 * @returns Invoice counter data including next formatted number
 */
export async function getInvoiceCounter(): Promise<InvoiceCounterData> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: ["SETTINGS!B8", "SETTINGS!B11", "SETTINGS!B17"],
  });
  const ranges = res.data.valueRanges ?? [];
  const prefix = (ranges[0]?.values?.[0]?.[0] as string | undefined) ?? "TTP";
  const yearRaw = (ranges[1]?.values?.[0]?.[0] as string | undefined) ?? "";
  const lastRaw = ranges[2]?.values?.[0]?.[0];
  const yearCode = yearRaw.replace("-", "");
  const lastNumber = lastRaw ? parseInt(String(lastRaw), 10) : 0;
  const nextNumber = lastNumber + 1;
  const nextFormatted = `${prefix}-${yearCode}-${String(nextNumber).padStart(4, "0")}`;
  return { prefix, yearCode, lastNumber, nextNumber, nextFormatted };
}

/**
 * Writes a new invoice count back to the Google Sheet SETTINGS tab.
 * @param newCount - The new invoice count to persist
 */
export async function setInvoiceCounter(newCount: number): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = getSheetId();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: "SETTINGS!B17",
    valueInputOption: "RAW",
    requestBody: { values: [[newCount]] },
  });
}
