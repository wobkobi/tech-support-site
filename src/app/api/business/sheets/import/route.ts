import { runSheetsImport } from "@/features/business/lib/sheets-import";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

// Raise the serverless ceiling so a slow upstream call (LLM / Google API / PDF) cannot 504 on the default timeout.
export const maxDuration = 60;

/**
 * GET /api/business/sheets/import - Dry-run preview of what would be imported.
 * @param request - Incoming Next.js request.
 * @returns JSON with counts of rows that would be imported or skipped.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const result = await runSheetsImport(true);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[sheets/import] GET failed:", err);
    return errorResponse("Sheet read failed", 503);
  }
}

/**
 * POST /api/business/sheets/import - Imports cashbook and expense rows into MongoDB.
 * @param request - Incoming Next.js request.
 * @returns JSON with counts of rows imported, skipped, and any row errors.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }
  try {
    const result = await runSheetsImport(false);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("[sheets/import] POST failed:", err);
    return errorResponse("Import failed", 503);
  }
}
