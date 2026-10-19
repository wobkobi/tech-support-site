// src/app/api/cron/sync-sheets/route.ts
// Hourly cron reconciling the Cashbook and Expenses sheets with MongoDB (sheet wins,
// matched by the column-Z Sync ID) and healing failed sheet appends.

import { runSheetsImport } from "@/features/business/lib/sheets-import";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorised } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/cron/sync-sheets
 * Reconciles the Cashbook and Expenses Google Sheets tabs with MongoDB.
 * @param request - Incoming cron request.
 * @returns JSON with counts of records imported, updated, skipped, and healed.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorised(request)) {
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
