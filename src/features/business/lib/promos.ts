// src/features/business/lib/promos.ts
/**
 * @description Active-promo lookup + helpers. Cached 60s; admin writes revalidate.
 */

import { prisma } from "@/shared/lib/prisma";
import { unstable_cache } from "next/cache";

/** Cache tag invalidated by the promo CRUD routes. */
export const ACTIVE_PROMO_TAG = "active-promo";

/** Plain-data promo shape exposed across the app. */
export interface ActivePromo {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  flatHourlyRate: number | null;
  percentDiscount: number | null;
}

/**
 * Returns the currently-active promo or null. Newest wins on overlap.
 * @returns Active promo or null.
 */
export const getActivePromo = unstable_cache(
  async (): Promise<ActivePromo | null> => {
    const now = new Date();
    const row = await prisma.promo.findFirst({
      where: {
        isActive: true,
        startAt: { lte: now },
        endAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      flatHourlyRate: row.flatHourlyRate,
      percentDiscount: row.percentDiscount,
    };
  },
  ["active-promo"],
  { tags: [ACTIVE_PROMO_TAG], revalidate: 60 },
);

/**
 * Resolves the promo that was in force on a given date (newest wins on
 * overlap). Used by the admin calculator to price a past job with the promo
 * that was live when the work actually happened, not today's.
 * @param date - The job date to resolve against.
 * @returns Resolved promo or null.
 */
export async function resolvePromoForDate(date: Date): Promise<ActivePromo | null> {
  const row = await prisma.promo
    .findFirst({
      where: { isActive: true, startAt: { lte: date }, endAt: { gt: date } },
      orderBy: { createdAt: "desc" },
    })
    .catch(() => null);
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    flatHourlyRate: row.flatHourlyRate,
    percentDiscount: row.percentDiscount,
  };
}

/** Promo snapshot fields stored on a Booking, plus its createdAt. */
export interface BookingPromoSnapshot {
  promoIdAtBooking?: string | null;
  promoTitleAtBooking?: string | null;
  promoFlatHourlyRateAtBooking?: number | null;
  promoPercentDiscountAtBooking?: number | null;
  createdAt: Date;
}

/**
 * Resolves the promo in force for a booking. Prefers the booking's snapshot
 * fields; falls back to a `createdAt` lookup against `Promo.startAt`/`endAt`
 * when no snapshot is present.
 * @param booking - Snapshot fields + createdAt.
 * @returns Resolved promo or null.
 */
export async function resolvePromoForBooking(
  booking: BookingPromoSnapshot,
): Promise<ActivePromo | null> {
  if (booking.promoIdAtBooking && booking.promoTitleAtBooking) {
    return {
      id: booking.promoIdAtBooking,
      title: booking.promoTitleAtBooking,
      description: null,
      startAt: booking.createdAt.toISOString(),
      endAt: booking.createdAt.toISOString(),
      flatHourlyRate: booking.promoFlatHourlyRateAtBooking ?? null,
      percentDiscount: booking.promoPercentDiscountAtBooking ?? null,
    };
  }
  const row = await prisma.promo
    .findFirst({
      where: {
        isActive: true,
        startAt: { lte: booking.createdAt },
        endAt: { gt: booking.createdAt },
      },
      orderBy: { createdAt: "desc" },
    })
    .catch(() => null);
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    flatHourlyRate: row.flatHourlyRate,
    percentDiscount: row.percentDiscount,
  };
}

/**
 * Applies a promo to one hourly rate. Flat overrides (capped at original); percent multiplies.
 * @param rate - Pre-promo $/hr.
 * @param promo - Active promo or null.
 * @returns Effective $/hr.
 */
export function applyPromoToHourlyRate(rate: number, promo: ActivePromo | null): number {
  if (!promo) return rate;
  if (promo.flatHourlyRate !== null) {
    // Never raise the price - a promo above the base rate is a misconfig.
    return Math.min(rate, promo.flatHourlyRate);
  }
  if (promo.percentDiscount !== null) {
    const factor = Math.max(0, 1 - promo.percentDiscount);
    return Math.round(rate * factor * 100) / 100;
  }
  return rate;
}

/**
 * Dollar discount to subtract from a labor subtotal for the active promo.
 * @param laborSubtotal - Time charge + hourly task totals.
 * @param laborHours - Billable labor hours (for flat-rate math).
 * @param promo - Active promo or null.
 * @returns Dollar discount.
 */
export function computePromoDiscount(
  laborSubtotal: number,
  laborHours: number,
  promo: ActivePromo | null,
): number {
  if (!promo || laborSubtotal <= 0) return 0;
  if (promo.flatHourlyRate !== null) {
    const promoTotal = laborHours * promo.flatHourlyRate;
    const discount = laborSubtotal - promoTotal;
    return discount > 0 ? Math.round(discount * 100) / 100 : 0;
  }
  if (promo.percentDiscount !== null) {
    const pct = Math.max(0, Math.min(1, promo.percentDiscount));
    return Math.round(laborSubtotal * pct * 100) / 100;
  }
  return 0;
}

/**
 * Friendly end-date phrase: "this Saturday" within a week, "Sat 16 May" beyond.
 * @param endIso - Promo `endAt` ISO timestamp.
 * @param now - Reference time (injected for tests).
 * @returns Short date phrase.
 */
function formatPromoEnd(endIso: string, now: Date = new Date()): string {
  const end = new Date(endIso);
  const diffDays = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  // Within a week: anchor on weekday ("I have until Friday").
  if (diffDays <= 7 && diffDays > 0) {
    const weekday = new Intl.DateTimeFormat("en-NZ", { weekday: "long" }).format(end);
    return `this ${weekday}`;
  }

  // Otherwise short date; year only if not current year.
  const sameYear = end.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(end);
}

/**
 * Customer-facing one-line summary for banner + pricing hero.
 * @param promo - Active promo.
 * @returns Banner string.
 */
export function summariseForBanner(promo: ActivePromo): string {
  const until = formatPromoEnd(promo.endAt);
  if (promo.flatHourlyRate !== null) {
    return `$${promo.flatHourlyRate}/hr on all jobs until ${until}`;
  }
  if (promo.percentDiscount !== null) {
    const pctLabel = `${Math.round(promo.percentDiscount * 100)}% off`;
    return `${pctLabel} all jobs until ${until}`;
  }
  return `Limited offer until ${until}`;
}
