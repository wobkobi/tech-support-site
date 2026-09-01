// src/app/api/business/job-context/route.ts
/**
 * @description GET /api/business/job-context?date=YYYY-MM-DD[&code=CODE][&email=] -
 * admin-only. Given the date a job was actually done, returns whether it was an
 * NZ public holiday (with the live labour uplift) and which promo applied that
 * day, so the calculator prices a past job by what applied then, not today.
 */

import { lookupPublicHoliday } from "@/features/business/lib/pricing-policy.server";
import { resolvePromo, type ActivePromo } from "@/features/business/lib/promos";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { NextRequest, NextResponse } from "next/server";

interface JobContextResponse {
  /** Holiday name when the date is an NZ public holiday, else null. */
  holidayName: string | null;
  /** Labour uplift fraction to apply (the live setting on a holiday, else 0). */
  holidayUplift: number;
  /**
   * Promo that applied on that date, or null. A code that resolves is returned
   * in place of the automatic promo; one that does not falls back to it, so the
   * caller compares `promo.code` to know whether the code took.
   */
  promo: ActivePromo | null;
}

/**
 * Resolves the holiday + promo context for a job date.
 * @param request - Incoming request with a `date` query param (YYYY-MM-DD), an
 * optional `code` for a job taken over the phone, and an optional `email` so
 * per-customer limits bind an operator-priced job too.
 * @returns JSON { holidayName, holidayUplift, promo }.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const dateStr = request.nextUrl.searchParams.get("date");
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return errorResponse("date (YYYY-MM-DD) is required", 400);
  }

  // Pin to NZ midday so the holiday/promo lookups land on the intended NZ day
  // regardless of server timezone or DST (+12/+13).
  const date = new Date(`${dateStr}T12:00:00+12:00`);

  // Resolved at the job date rather than now: a code valid today may not have
  // been running on the day the work happened, and the invoice must reflect the
  // day.
  const code = request.nextUrl.searchParams.get("code");
  // Per-customer and new-customer limits need someone to judge. Without it an
  // operator-priced job would quietly ignore a limit the public flow enforces.
  const email = request.nextUrl.searchParams.get("email");

  const [settings, holiday, promo] = await Promise.all([
    getSettings(),
    lookupPublicHoliday(date).catch(() => null),
    resolvePromo({ at: date, code, email }).catch(() => null),
  ]);

  const body: JobContextResponse = {
    holidayName: holiday?.name ?? null,
    holidayUplift: holiday ? settings.pricing.publicHolidayUplift : 0,
    promo,
  };
  return NextResponse.json({ ok: true, ...body });
}
