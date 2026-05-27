// src/app/api/pricing/public-holiday/route.ts
/**
 * @file route.ts
 * @description Public endpoint exposing the NZ-local stat-day lookup so the
 * wizard can auto-apply the Public Holiday modifier when the customer's
 * chosen booking time falls on a holiday.
 */

import { NextRequest, NextResponse } from "next/server";
import { lookupPublicHoliday } from "@/features/business/lib/pricing-policy.server";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";

/**
 * GET /api/pricing/public-holiday?date=YYYY-MM-DD
 * Returns `{ holiday: { name, region } | null }` for the given NZ-local date.
 * Empty / malformed `date` returns `holiday: null` rather than 400 so the
 * wizard never blocks on a malformed query.
 * @param request - Incoming request with `date` query string.
 * @returns JSON `{ holiday }` or rate-limit response.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const limited = rateLimitOrReject(request, "public-holiday", 60, 60_000);
  if (limited) return limited;

  const raw = request.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return NextResponse.json({ holiday: null });
  }
  const [y, m, d] = raw.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const holiday = await lookupPublicHoliday(noon).catch(() => null);
  return NextResponse.json({ holiday });
}
