// src/features/booking/lib/owner-booking-summary.server.ts
// What the owner's booking email adds beyond the notes: the customer's phone and history, and
// the quote priced at the booking's current slot (priceOwnerQuote in owner-quote.ts).

import { priceOwnerQuote, type OwnerQuoteBreakdown } from "@/features/booking/lib/owner-quote";
import { formatQuotedRange } from "@/features/business/lib/estimate-range";
import { dateSurcharge } from "@/features/business/lib/pricing-policy";
import { lookupPublicHoliday } from "@/features/business/lib/pricing-policy.server";
import { promoForJob } from "@/features/business/lib/promos";
import type { RateConfig } from "@/features/business/types/business";
import { formatNZPhone } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { nzMinuteOfDay, nzWeekday } from "@/shared/lib/timezone-utils";

/** Everything the owner's booking email shows about the customer and the price. */
export interface OwnerBookingSummary {
  /** Phone in NZ display form ("021 041 0186"), or null when none was given. */
  phone: string | null;
  /** The stored E.164 number for a tel: link (the email strips it to digits and +), or null. */
  phoneTel: string | null;
  /** "New customer", or "Returning customer" with their earlier bookings. */
  history: string;
  /** Null when no Standard rate row exists to price from. */
  breakdown: OwnerQuoteBreakdown | null;
}

/**
 * Reads a saved booking and builds its owner summary: phone, history, and the quote priced at
 * the booking's current slot with the promo the invoice would use ({@link promoForJob}).
 * @param bookingId - The booking, already saved with its latest time and snapshots.
 * @returns The summary, or null when the booking is gone or a read fails (logged).
 */
export async function loadOwnerBookingSummary(
  bookingId: string,
): Promise<OwnerBookingSummary | null> {
  try {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return null;

    const [settings, rateRows, holiday, promo, earlierBookings, contact] = await Promise.all([
      getSettings(),
      prisma.rateConfig.findMany({ orderBy: { label: "asc" } }),
      lookupPublicHoliday(booking.startAt).catch(() => null),
      promoForJob({ at: booking.startAt, bookingId: booking.id, email: booking.email }).catch(
        () => null,
      ),
      prisma.booking.count({
        where: {
          email: booking.email,
          id: { not: booking.id },
          status: { not: "cancelled" },
          startAt: { lt: booking.startAt },
        },
      }),
      prisma.contact.findFirst({
        where: {
          OR: [{ email: booking.email }, { altEmails: { has: booking.email } }],
          deletedAt: null,
        },
        select: { createdAt: true },
      }),
    ]);

    const rates: RateConfig[] = rateRows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    }));
    const tasks =
      booking.quotedTasksAtBooking.length > 0
        ? booking.quotedTasksAtBooking
        : booking.quotedMinsAtBooking
          ? [{ label: "Labour", mins: booking.quotedMinsAtBooking }]
          : [];
    const travel =
      booking.meetingType !== "remote" && booking.travelMinsAtBooking != null
        ? {
            minsThere: booking.travelMinsAtBooking,
            minsBack: booking.travelMinsBackAtBooking ?? booking.travelMinsAtBooking,
            ratePerHour: booking.travelRatePerHourAtBooking ?? settings.pricing.travelRatePerHour,
          }
        : null;
    const quoted =
      booking.quotedLowAtBooking !== null && booking.quotedHighAtBooking !== null
        ? formatQuotedRange(
            booking.quotedLowAtBooking,
            booking.quotedHighAtBooking,
            booking.quotedTravelAtBooking,
          )
        : null;

    // The request route upserts the contact after the booking row, so a contact made before
    // the booking means they were already known (an earlier job, or Google Contacts).
    const knownBefore = contact !== null && contact.createdAt < booking.createdAt;
    const history =
      earlierBookings > 0
        ? `Returning customer: ${earlierBookings} earlier booking${earlierBookings === 1 ? "" : "s"}`
        : knownBefore
          ? "Returning customer: already in your contacts"
          : "New customer";

    return {
      phone: booking.phone ? formatNZPhone(booking.phone.replace(/^\+64/, "0")) : null,
      phoneTel: booking.phone || null,
      history,
      breakdown: priceOwnerQuote({
        tasks,
        rates,
        remote: booking.meetingType === "remote",
        promo,
        surcharge: dateSurcharge(
          holiday?.name ?? null,
          nzWeekday(booking.startAt),
          settings.pricing,
          nzMinuteOfDay(booking.startAt),
        ),
        travel,
        pricing: settings.pricing,
        quoted,
      }),
    };
  } catch (err) {
    console.error("[owner-booking-summary] Failed to build the summary:", err);
    return null;
  }
}
