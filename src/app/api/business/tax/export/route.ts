// src/app/api/business/tax/export/route.ts
// Accountant CSV for one financial year (`?fy=2025-26`): the saved snapshot when the year
// is filed, otherwise live figures. A filed year whose snapshot can't be read exports the
// live figures rather than failing. Admin only, never cached.

import { buildTaxCsv } from "@/features/business/lib/tax/export-csv";
import { loadTaxYearView, resolveFinancialYear } from "@/features/business/lib/tax/view.server";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { NextRequest, NextResponse } from "next/server";

/**
 * Marks a response as never cacheable: it carries the business's tax figures.
 * @param res - Response to mark.
 * @returns The same response.
 */
function noStore<T>(res: NextResponse<T>): NextResponse<T> {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

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

  // `shown` is the live figures when the filed snapshot can't be read, so this can't throw
  // on it; the filing date still goes in the status line so the CSV doesn't read as unfiled.
  const view = await loadTaxYearView(fy, now);
  const csv = buildTaxCsv(view.shown, {
    fyLabel: fy.label,
    generatedAt: now,
    unreadableFiledAt: view.snapshotUnreadable ? view.filedAtIso : null,
  });
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tax-summary-${fyKey}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
