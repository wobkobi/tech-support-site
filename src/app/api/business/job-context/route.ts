// src/app/api/business/job-context/route.ts
// GET /api/business/job-context?date=YYYY-MM-DD[&time=HH:MM][&code=CODE][&email=][&bookingId=]
// - admin-only. The date surcharge and promo that applied when a job was done, so a past
// job prices by what applied then. A booked job keeps its locked-in promo.

import { dateSurcharge, type DateSurcharge } from "@/features/business/lib/pricing-policy";
import { lookupPublicHoliday } from "@/features/business/lib/pricing-policy.server";
import {
  lockedInPromo,
  normalisePromoCode,
  resolvePromo,
  type ActivePromo,
} from "@/features/business/lib/promos";
import { parseObjectId } from "@/features/business/lib/validation";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
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
 * `email` (for per-customer limits) and `bookingId`.
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

  const code = normalisePromoCode(params.get("code"));
  // Lets per-customer limits bind an operator-priced job too.
  const email = params.get("email");
  const bookingId = parseObjectId(params.get("bookingId"));

  const booking = bookingId
    ? await prisma.booking
        .findUnique({
          where: { id: bookingId },
          select: { promoIdAtBooking: true, promoTermsAtBooking: true, createdAt: true },
        })
        .catch(() => null)
    : null;
  // Carry the booked promo through; re-resolving live would lose a booked code.
  const locked = booking?.promoIdAtBooking
    ? await lockedInPromo(booking.promoIdAtBooking, at, booking.promoTermsAtBooking)
    : null;

  const [settings, holiday, resolved] = await Promise.all([
    getSettings(),
    lookupPublicHoliday(at).catch(() => null),
    // Skipped when the locked-in promo stands. Dates are judged at booking time, and
    // the booking's own redemption is left out of its limits.
    locked && !code
      ? Promise.resolve(null)
      : resolvePromo({
          at,
          bookedAt: booking?.createdAt,
          bookingId,
          code,
          email,
        }).catch(() => null),
  ]);
  const codeTook = code !== null && resolved?.code === code;

  const holidayName = holiday?.name ?? null;
  const body: JobContextResponse = {
    holidayName,
    surcharge: dateSurcharge(holidayName, nzWeekday(at), settings.pricing),
    promo: codeTook ? resolved : (locked ?? resolved),
  };
  return NextResponse.json({ ok: true, ...body });
}
