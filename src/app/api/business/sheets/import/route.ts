import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/shared/lib/auth";
import { runSheetsImport } from "@/features/business/lib/sheets-import";

/**
 * GET /api/business/sheets/import - Dry-run preview of what would be imported.
 * @param request - Incoming Next.js request.
 * @returns JSON with counts of rows that would be imported or skipped.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runSheetsImport(true);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[sheets/import] GET failed:", err);
    return NextResponse.json({ error: "Sheet read failed" }, { status: 503 });
  }
}

/**
 * POST /api/business/sheets/import - Imports cashbook and expense rows into MongoDB.
 * @param request - Incoming Next.js request.
 * @returns JSON with counts of rows imported, skipped, and any row errors.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runSheetsImport(false);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error("[sheets/import] POST failed:", err);
    return NextResponse.json({ error: "Import failed" }, { status: 503 });
  }
}
