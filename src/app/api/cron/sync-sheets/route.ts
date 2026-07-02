// src/app/api/cron/sync-sheets/route.ts
/**
 * @description Cron endpoint (Bearer-authorised) that reconciles the Cashbook
 * and Expenses Google Sheets tabs with MongoDB via {@link runSheetsImport}
 * (sheet wins; matched by the hidden column-Z Sync ID) and self-heals site
 * entries whose sheet append failed. GET runs hourly via cron-job.org and
 * returns 503 when the sync fails.
 */

import { runSheetsImport } from "@/features/business/lib/sheets-import";
import { errorResponse } from "@/shared/lib/api-response";
import { isCronAuthorized } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// Reconciliation walks every per-FY workbook and can retry transient Google
// API failures with backoff, so give it well beyond the 60s default.
export const maxDuration = 300;

/**
 * GET /api/cron/sync-sheets
 * Reconciles the Cashbook and Expenses Google Sheets tabs with MongoDB.
 * Run hourly via cron-job.org with Authorization: Bearer <CRON_SECRET>.
 * @param request - Incoming cron request.
 * @returns JSON with counts of records imported, updated, skipped, and healed.
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
