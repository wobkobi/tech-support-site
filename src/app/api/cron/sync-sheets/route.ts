import { runSheetsImport } from "@/features/business/lib/sheets-import";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorized } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/cron/sync-sheets
 * Imports new rows from the Cashbook and Expenses Google Sheets tabs into MongoDB.
 * Run hourly via cron-job.org with Authorization: Bearer <CRON_SECRET>.
 * @param request - Incoming cron request.
 * @returns JSON with counts of records imported and skipped.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(request)) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const result = await runSheetsImport(false);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cron/sync-sheets] failed:", err);
    return errorResponse("Sync failed", 503);
  }
}
