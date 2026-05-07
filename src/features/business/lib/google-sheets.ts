import { google } from "googleapis";
import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";

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
