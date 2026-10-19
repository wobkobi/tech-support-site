// src/app/api/pricing/public-holiday/route.ts
// Public NZ stat-day lookup so the wizard can auto-apply the Public Holiday modifier.

import { lookupPublicHoliday } from "@/features/business/lib/pricing-policy.server";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { dateKeyParts } from "@/shared/lib/timezone-utils";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/pricing/public-holiday?date=YYYY-MM-DD
 * Malformed `date` returns `holiday: null`, not 400, so the wizard never blocks.
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
  const [y, m, d] = dateKeyParts(raw);
  const noon = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const holiday = await lookupPublicHoliday(noon).catch(() => null);
  return NextResponse.json({ holiday });
}
