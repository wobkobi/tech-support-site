// src/app/api/business/job-context/route.ts
// GET /api/business/job-context?date=YYYY-MM-DD[&time=HH:MM][&code=CODE][&email=][&bookingId=]
// - admin-only. Given when a job was actually done, returns whether it was an NZ public
// holiday (with the live labour uplift) and which promo applies, so the calculator prices
// a past job by what applied then, not today. A booked job keeps the promo it locked in.

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
import { dateKeyParts, nzWallClockUtc, timeParts } from "@/shared/lib/timezone-utils";
import { NextRequest, NextResponse } from "next/server";

interface JobContextResponse {
  /** Holiday name when the date is an NZ public holiday, else null. */
  holidayName: string | null;
  /** Labour uplift fraction to apply (the live setting on a holiday, else 0). */
  holidayUplift: number;
  /**
   * Promo that applies to the job, or null. A code that resolves is returned
   * in place of the booking's locked-in or automatic promo; one that does not
   * falls back to them, so the caller compares `promo.code` to know whether
   * the code took.
   */
  promo: ActivePromo | null;
}

/**
 * Resolves the holiday + promo context for a job date.
 * @param request - Incoming request with a `date` query param (YYYY-MM-DD), an
 * optional `time` (HH:MM, the job's NZ start) so a time-of-day promo judges the
 * real start, an optional `code` for a job taken over the phone, an optional
 * `email` so per-customer limits bind an operator-priced job too, and an
 * optional `bookingId` when billing a booked job.
 * @returns JSON { holidayName, holidayUplift, promo }.
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

  // The job's real start when the calculator knows it, else NZ midday, which
  // lands on the intended NZ day whatever the server timezone or DST offset.
  // A time-of-day promo needs the real start: judged at noon, an evening-only
  // promo would never apply to an evening job.
  const timeStr = params.get("time");
  const [hour, minute] = timeStr && /^\d{2}:\d{2}$/.test(timeStr) ? timeParts(timeStr) : [12, 0];
  const [year, month, day] = dateKeyParts(dateStr);
  const at = nzWallClockUtc(year, month, day, hour, minute);

  const code = normalisePromoCode(params.get("code"));
  // Per-customer and new-customer limits need someone to judge. Without it an
  // operator-priced job would quietly ignore a limit the public flow enforces.
  const email = params.get("email");
  const bookingId = parseObjectId(params.get("bookingId"));

  const booking = bookingId
    ? await prisma.booking
        .findUnique({
          where: { id: bookingId },
          select: { promoIdAtBooking: true, createdAt: true },
        })
        .catch(() => null)
    : null;
  // The promo the customer booked with, carried to the invoice. Re-resolving it
  // live instead would lose a booked code, and an automatic promo would settle a
  // second redemption for the same job.
  const locked = booking?.promoIdAtBooking
    ? await lockedInPromo(booking.promoIdAtBooking, at)
    : null;

  const [settings, holiday, resolved] = await Promise.all([
    getSettings(),
    lookupPublicHoliday(at).catch(() => null),
    // Skipped when the locked-in promo stands and no code could displace it.
    // Otherwise the dates are judged when the booking was made (a walk-up job
    // is booked the day it is done), and the booking's own redemption is left
    // out of its limits.
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

  const body: JobContextResponse = {
    holidayName: holiday?.name ?? null,
    holidayUplift: holiday ? settings.pricing.publicHolidayUplift : 0,
    promo: codeTook ? resolved : (locked ?? resolved),
  };
  return NextResponse.json({ ok: true, ...body });
}
