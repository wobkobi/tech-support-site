// src/app/api/business/job-context/route.ts
// GET /api/business/job-context?date=YYYY-MM-DD[&time=HH:MM][&code=CODE][&email=][&bookingId=]
// [&bookedAt=ISO] - admin-only. The date surcharge and promo that applied when a job was done,
// so a past job prices by what applied then. A booked job keeps its locked-in promo, and a
// calendar-only job judges promo dates at when its event was made.

import { dateSurcharge, type DateSurcharge } from "@/features/business/lib/pricing-policy";
import { lookupPublicHoliday } from "@/features/business/lib/pricing-policy.server";
import { promoForJob, type ActivePromo } from "@/features/business/lib/promos";
import { parseObjectId } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { dateKeyParts, nzWallClockUtc, nzWeekday, timeParts } from "@/shared/lib/timezone-utils";
import { NextRequest, NextResponse } from "next/server";

interface JobContextResponse {
  /** Holiday name when the date is an NZ public holiday, else null. */
  holidayName: string | null;
  /** Labour surcharge for the date (holiday first, else weekend), or null when neither applies. */
  surcharge: DateSurcharge | null;
  /** Promo for the job, or null. Compare `promo.code` to see whether a sent code took. */
  promo: ActivePromo | null;
}

/**
 * Resolves the holiday + promo context for a job date.
 * @param request - Query: `date` (YYYY-MM-DD), optional `time` (HH:MM NZ start), `code`,
 * `email` (for per-customer limits), `bookingId` and `bookedAt` (when the job's event was made).
 * @returns JSON { holidayName, surcharge, promo }.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) {
    return errorResponse("Unauthorized", 401);
  }

  const params = request.nextUrl.searchParams;
  const dateStr = params.get("date");
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return errorResponse("date (YYYY-MM-DD) is required", 400);
  }

  // The real start when known (an evening-only promo needs it), else NZ midday, which
  // lands on the right NZ day whatever the server timezone or DST offset.
  const timeStr = params.get("time");
  const [hour, minute] = timeStr && /^\d{2}:\d{2}$/.test(timeStr) ? timeParts(timeStr) : [12, 0];
  const [year, month, day] = dateKeyParts(dateStr);
  const at = nzWallClockUtc(year, month, day, hour, minute);

  const [settings, holiday, promo] = await Promise.all([
    getSettings(),
    lookupPublicHoliday(at).catch(() => null),
    promoForJob({
      at,
      bookingId: parseObjectId(params.get("bookingId")),
      bookedAt: params.get("bookedAt"),
      code: params.get("code"),
      // Lets per-customer limits bind an operator-priced job too.
      email: params.get("email"),
    }),
  ]);

  const holidayName = holiday?.name ?? null;
  const body: JobContextResponse = {
    holidayName,
    surcharge: dateSurcharge(holidayName, nzWeekday(at), settings.pricing),
    promo,
  };
  return NextResponse.json({ ok: true, ...body });
}
