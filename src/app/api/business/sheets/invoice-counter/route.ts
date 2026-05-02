import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getOAuth2Client } from "@/features/calendar/lib/google-calendar";
import { isAdminRequest } from "@/shared/lib/auth";

/**
 * Creates an authenticated Google Sheets API client.
 * @returns Sheets v4 API client instance
 */
function getSheetsClient(): ReturnType<typeof google.sheets> {
  const auth = getOAuth2Client();
  return google.sheets({ version: "v4", auth });
}

/**
 * Reads the Google Sheet ID from environment variables.
 * @returns GOOGLE_SHEET_ID value
 */
function getSheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID is not set");
  return id;
}

/**
 * GET /api/business/sheets/invoice-counter - Reads the next invoice number from the Google Sheet.
 * @param request - Incoming Next.js request
 * @returns JSON with lastNumber, nextNumber, yearCode, nextFormatted, and prefix
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
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

    return NextResponse.json({ ok: true, lastNumber, nextNumber, yearCode, nextFormatted, prefix });
  } catch (err) {
    console.error("[sheets/invoice-counter] GET failed:", err);
    return NextResponse.json({ error: "Sheet unavailable" }, { status: 503 });
  }
}

/**
 * POST /api/business/sheets/invoice-counter - Writes the new invoice count back to the Google Sheet.
 * @param request - Incoming Next.js request with newCount in body
 * @returns JSON confirmation with the written count
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const newCount = Number(body.newCount);
    if (!Number.isInteger(newCount) || newCount < 0) {
      return NextResponse.json(
        { error: "newCount must be a non-negative integer" },
        { status: 400 },
      );
    }

    const sheets = getSheetsClient();
    const spreadsheetId = getSheetId();

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "SETTINGS!B17",
      valueInputOption: "RAW",
      requestBody: { values: [[newCount]] },
    });

    return NextResponse.json({ ok: true, written: newCount });
  } catch (err) {
    console.error("[sheets/invoice-counter] POST failed:", err);
    return NextResponse.json({ error: "Sheet write failed" }, { status: 503 });
  }
}
