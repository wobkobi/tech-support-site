import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/shared/lib/auth";
import { runSheetsImport } from "@/features/business/lib/sheets-import";

/**
 * GET /api/cron/sync-sheets
 * Imports new rows from the Cashbook and Expenses Google Sheets tabs into MongoDB.
 * Run hourly via cron-job.org with Authorization: Bearer <CRON_SECRET>.
 * @param request - Incoming cron request.
 * @returns JSON with counts of records imported and skipped.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runSheetsImport(false);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cron/sync-sheets] failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 503 });
  }
}
