// src/features/business/lib/promo-redemption.ts
// Promo redemption bookkeeping. Never throws: bookings and invoices must not depend on it.

import { lockedInPromo, resolvePromo, type ActivePromo } from "@/features/business/lib/promos";
import { refreshPromoCacheAtBoundary } from "@/features/business/lib/promos.server";
import { prisma } from "@/shared/lib/prisma";

/** Matches a redemption no invoice has settled; Mongo's null match misses an unset field. */
const UNSETTLED = { OR: [{ invoiceId: null }, { invoiceId: { isSet: false } }] };

/**
 * Re-checks the advertised promo after redemptions of these promos changed, so the banner and
 * /pricing drop a promo the moment its total cap fills (and bring it back when one frees up).
 * Uncapped promos can't change the answer, so they cost one count. Never throws.
 * @param promoIds - Promos whose redemptions were just written.
 * @returns Promise that resolves once the check has been attempted.
 */
async function refreshIfCapped(promoIds: readonly string[]): Promise<void> {
  const ids = [...new Set(promoIds)];
  if (ids.length === 0) return;
  try {
    const capped = await prisma.promo.count({
      where: { id: { in: ids }, maxRedemptions: { not: null } },
    });
    if (capped > 0) await refreshPromoCacheAtBoundary();
  } catch (err) {
    console.error("[promos] Failed to refresh the promo cache after a redemption:", err);
  }
}

/** One promo use to record. */
export interface RedemptionInput {
  /** The promo that applied. */
  promoId: string;
  /** Booking this redemption came from, when it came from one. */
  bookingId?: string;
  /** Invoice this redemption came from, when it came from one. */
  invoiceId?: string;
  /** Customer, when known. */
  contactId?: string;
  /** Dollar value of the discount, or null when it was not measured. */
  discountValue?: number | null;
}

/**
 * Records a promo redemption, swallowing every error. Awaited only so it runs before Vercel
 * freezes the instance.
 * @param input - The redemption to record.
 * @returns Promise that resolves once the write has been attempted.
 */
export async function recordPromoRedemption(input: RedemptionInput): Promise<void> {
  try {
    await prisma.promoRedemption.create({
      data: {
        promoId: input.promoId,
        bookingId: input.bookingId ?? null,
        invoiceId: input.invoiceId ?? null,
        contactId: input.contactId ?? null,
        discountValue: input.discountValue ?? null,
      },
    });
  } catch (err) {
    console.error("[promos] Failed to record redemption:", err);
    return;
  }
  await refreshIfCapped([input.promoId]);
}

/** One promo use being settled against a finished invoice. */
export interface SettleInput {
  /** The promo that applied. */
  promoId: string;
  /** Invoice carrying the realised discount. */
  invoiceId: string;
  /** Booking the invoice bills, when it bills one. */
  bookingId?: string | null;
  /** Customer, when known. */
  contactId?: string | null;
  /** Dollar value of the discount actually given. */
  discountValue: number;
}

/**
 * Records what a promo was really worth once invoiced. Takes over the booking-time row while no
 * invoice has settled it (so one job is one redemption), else creates one: a walk-up job, a
 * re-issue after a void, or a second invoice billing the same booking. Releases the booking's
 * unsettled rows for any other promo. Never throws.
 * @param input - The redemption to settle.
 * @returns Promise that resolves once the write has been attempted.
 */
export async function settlePromoRedemption(input: SettleInput): Promise<void> {
  try {
    const existing = input.bookingId
      ? await prisma.promoRedemption.findFirst({
          where: { promoId: input.promoId, bookingId: input.bookingId, ...UNSETTLED },
          select: { id: true },
        })
      : null;

    if (existing) {
      await prisma.promoRedemption.update({
        where: { id: existing.id },
        data: {
          invoiceId: input.invoiceId,
          discountValue: input.discountValue,
          ...(input.contactId ? { contactId: input.contactId } : {}),
        },
      });
    } else {
      await prisma.promoRedemption.create({
        data: {
          promoId: input.promoId,
          bookingId: input.bookingId ?? null,
          invoiceId: input.invoiceId,
          contactId: input.contactId ?? null,
          discountValue: input.discountValue,
        },
      });
    }

    if (input.bookingId) {
      await prisma.promoRedemption.deleteMany({
        where: { bookingId: input.bookingId, promoId: { not: input.promoId }, ...UNSETTLED },
      });
    }
  } catch (err) {
    console.error("[promos] Failed to settle redemption:", err);
    return;
  }
  await refreshIfCapped([input.promoId]);
}

/**
 * Releases a booking's unsettled redemptions once the promo won't be used (cancelled,
 * no-show, or billed without it), so a rebooking isn't refused it. Never throws.
 * @param bookingId - The booking whose unsettled redemptions to release.
 * @returns Promise that resolves once the delete has been attempted.
 */
export async function releaseBookingRedemptions(bookingId: string): Promise<void> {
  let promoIds: string[] = [];
  try {
    const where = { bookingId, ...UNSETTLED };
    const rows = await prisma.promoRedemption.findMany({ where, select: { promoId: true } });
    promoIds = rows.map((r) => r.promoId);
    if (promoIds.length > 0) await prisma.promoRedemption.deleteMany({ where });
  } catch (err) {
    console.error("[promos] Failed to release booking redemptions:", err);
    return;
  }
  await refreshIfCapped(promoIds);
}

/**
 * Releases what a voided or deleted invoice settled: its own rows go, since it gave no
 * discount. A booking it billed keeps a use only while another live invoice bills that booking;
 * otherwise the booking's leftover unsettled rows go too. A re-issue that bills the booking
 * settles a fresh row. Never throws.
 * @param invoiceId - The voided or deleted invoice.
 * @returns Promise that resolves once the writes have been attempted.
 */
export async function releaseInvoiceRedemptions(invoiceId: string): Promise<void> {
  const promoIds: string[] = [];
  const bookingIds = new Set<string>();
  try {
    const rows = await prisma.promoRedemption.findMany({
      where: { invoiceId },
      select: { promoId: true, bookingId: true },
    });
    for (const row of rows) {
      promoIds.push(row.promoId);
      if (row.bookingId) bookingIds.add(row.bookingId);
    }
    if (rows.length > 0) await prisma.promoRedemption.deleteMany({ where: { invoiceId } });
  } catch (err) {
    console.error("[promos] Failed to release invoice redemptions:", err);
    return;
  }
  await refreshIfCapped(promoIds);

  for (const bookingId of bookingIds) {
    try {
      // A quote bills nothing, so it doesn't hold the booking's use either.
      const otherLive = await prisma.invoice.count({
        where: {
          bookingId,
          id: { not: invoiceId },
          status: { not: "VOIDED" },
          OR: [{ isQuote: false }, { isQuote: null }, { isQuote: { isSet: false } }],
        },
      });
      if (otherLive === 0) await releaseBookingRedemptions(bookingId);
    } catch (err) {
      console.error("[promos] Failed to check a voided invoice's booking:", err);
    }
  }
}

/** The booking fields a reschedule needs to re-judge its promo. */
export interface MovingBooking {
  id: string;
  email: string;
  createdAt: Date;
  promoIdAtBooking: string | null;
  promoTitleAtBooking: string | null;
  promoTermsAtBooking: unknown;
}

/** A rescheduled booking's promo, judged at its new slot. */
export interface MovedBookingPromo {
  /** False when the booked promo still covers the new slot, so nothing changes. */
  changed: boolean;
  /** The promo the booking carries at the new slot, or null for none. */
  promo: ActivePromo | null;
  /** The booked promo's title when the new slot loses it, else null. */
  lapsedTitle: string | null;
}

/**
 * Re-judges a booking's promo at a new slot. The locked-in terms stay while their days and
 * times still cover it; otherwise the promo is resolved as if this slot had been booked when
 * the booking was made (dates at booking, window at the slot). Reads only, never throws.
 * @param booking - The booking being moved.
 * @param startAt - The new appointment start.
 * @returns Whether the promo changed, the promo now carried, and any lapsed title.
 */
export async function judgeMovedBookingPromo(
  booking: MovingBooking,
  startAt: Date,
): Promise<MovedBookingPromo> {
  const unchanged = { changed: false, promo: null, lapsedTitle: null };
  try {
    if (booking.promoIdAtBooking) {
      const kept = await lockedInPromo(
        booking.promoIdAtBooking,
        startAt,
        booking.promoTermsAtBooking,
      );
      if (kept) return { ...unchanged, promo: kept };
    }
    const promo = await resolvePromo({
      at: startAt,
      bookedAt: booking.createdAt,
      bookingId: booking.id,
      email: booking.email,
    });
    const changed = (promo?.id ?? null) !== (booking.promoIdAtBooking ?? null);
    return {
      changed,
      promo,
      lapsedTitle: changed && booking.promoIdAtBooking ? booking.promoTitleAtBooking : null,
    };
  } catch (err) {
    console.error("[promos] Failed to re-judge a moved booking's promo:", err);
    return unchanged;
  }
}

/**
 * Moves a rescheduled booking's redemption to the promo it now carries. Call only once the
 * move is saved. Never throws.
 * @param bookingId - The moved booking.
 * @param moved - What {@link judgeMovedBookingPromo} decided.
 * @param contactId - The customer, so a per-customer limit still binds.
 * @returns Promise that resolves once the writes have been attempted.
 */
export async function applyMovedBookingPromo(
  bookingId: string,
  moved: MovedBookingPromo,
  contactId?: string,
): Promise<void> {
  if (!moved.changed) return;
  await releaseBookingRedemptions(bookingId);
  if (moved.promo) {
    await recordPromoRedemption({ promoId: moved.promo.id, bookingId, contactId });
  }
}
