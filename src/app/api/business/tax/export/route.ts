// src/app/api/business/tax/export/route.ts
// Accountant CSV for one FY (`?fy=2025-26`): the filed snapshot, else (or if unreadable)
// live figures. Admin only, never cached.

import { buildTaxCsv } from "@/features/business/lib/tax/export-csv";
import { loadTaxYearView, resolveFinancialYear } from "@/features/business/lib/tax/view.server";
import { errorResponse, noStore } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/business/tax/export?fy=<key> - Downloads the year's accountant CSV.
 * @param request - Incoming request.
 * @returns The CSV as an attachment, or `{ ok: false, error }` with 400/401/404.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return noStore(errorResponse("Unauthorized", 401));

  const fyKey = request.nextUrl.searchParams.get("fy") ?? "";
  if (!fyKey) return noStore(errorResponse("Missing fy", 400));

  const now = new Date();
  const fy = await resolveFinancialYear(fyKey, now);
  if (!fy) return noStore(errorResponse("Unknown financial year", 404));

  // An unreadable snapshot falls back to live figures; still note the filing date.
  const view = await loadTaxYearView(fy, now);
  const csv = buildTaxCsv(view.shown, {
    fyLabel: fy.label,
    generatedAt: now,
    unreadableFiledAt: view.snapshotUnreadable ? view.filedAtIso : null,
  });
  return noStore(
    new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="tax-summary-${fyKey}.csv"`,
      },
    }),
  );
}
