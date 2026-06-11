// src/app/api/business/job-context/route.ts
/**
 * @file route.ts
 * @description GET /api/business/job-context?date=YYYY-MM-DD - admin-only.
 * Given the date a job was actually done, returns whether it was an NZ public
 * holiday (with the live labour uplift) and which promo was live that day, so
 * the calculator prices a past job by what applied then, not today.
 */

import { lookupPublicHoliday } from "@/features/business/lib/pricing-policy.server";
import { resolvePromoForDate, type ActivePromo } from "@/features/business/lib/promos";
import { isAdminRequest } from "@/shared/lib/auth";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

interface JobContextResponse {
  /** Holiday name when the date is an NZ public holiday, else null. */
  holidayName: string | null;
  /** Labour uplift fraction to apply (the live setting on a holiday, else 0). */
  holidayUplift: number;
  /** Promo that was live on that date, or null. */
  promo: ActivePromo | null;
}

/**
 * Resolves the holiday + promo context for a job date.
 * @param request - Incoming request with a `date` query param (YYYY-MM-DD).
 * @returns JSON { holidayName, holidayUplift, promo }.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dateStr = request.nextUrl.searchParams.get("date");
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) is required" }, { status: 400 });
  }

  // Pin to NZ midday so the holiday/promo lookups land on the intended NZ day
  // regardless of server timezone or DST (+12/+13).
  const date = new Date(`${dateStr}T12:00:00+12:00`);

  const [settings, holiday, promo] = await Promise.all([
    getSettings(),
    lookupPublicHoliday(date).catch(() => null),
    resolvePromoForDate(date).catch(() => null),
  ]);

  const body: JobContextResponse = {
    holidayName: holiday?.name ?? null,
    holidayUplift: holiday ? settings.pricing.publicHolidayUplift : 0,
    promo,
  };
  return NextResponse.json({ ok: true, ...body });
}
