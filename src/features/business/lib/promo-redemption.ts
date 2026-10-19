// src/features/business/lib/promo-redemption.ts
// Promo redemption bookkeeping. Never throws: bookings and invoices must not depend on it.

import { prisma } from "@/shared/lib/prisma";

/** Matches a redemption no invoice has settled; Mongo's null match misses an unset field. */
const UNSETTLED = { OR: [{ invoiceId: null }, { invoiceId: { isSet: false } }] };

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
  }
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
 * Records what a promo was really worth once invoiced. Updates the booking-time row (so one job
 * is one redemption) or creates one for walk-up jobs, and releases the booking's rows for any
 * other promo. Never throws.
 * @param input - The redemption to settle.
 * @returns Promise that resolves once the write has been attempted.
 */
export async function settlePromoRedemption(input: SettleInput): Promise<void> {
  try {
    const existing = input.bookingId
      ? await prisma.promoRedemption.findFirst({
          where: { promoId: input.promoId, bookingId: input.bookingId },
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
  }
}

/**
 * Releases a booking's unsettled redemptions once the promo won't be used (cancelled,
 * no-show, or billed without it), so a rebooking isn't refused it. Never throws.
 * @param bookingId - The booking whose unsettled redemptions to release.
 * @returns Promise that resolves once the delete has been attempted.
 */
export async function releaseBookingRedemptions(bookingId: string): Promise<void> {
  try {
    await prisma.promoRedemption.deleteMany({ where: { bookingId, ...UNSETTLED } });
  } catch (err) {
    console.error("[promos] Failed to release booking redemptions:", err);
  }
}

/**
 * Releases what a voided invoice settled: booking rows revert to their booking-time state
 * (so a re-issue still counts once), invoice-only rows are deleted. Never throws.
 * @param invoiceId - The voided invoice.
 * @returns Promise that resolves once the writes have been attempted.
 */
export async function releaseInvoiceRedemptions(invoiceId: string): Promise<void> {
  try {
    await prisma.promoRedemption.updateMany({
      where: { invoiceId, bookingId: { not: null } },
      data: { invoiceId: null, discountValue: null },
    });
    await prisma.promoRedemption.deleteMany({
      where: { invoiceId, OR: [{ bookingId: null }, { bookingId: { isSet: false } }] },
    });
  } catch (err) {
    console.error("[promos] Failed to release invoice redemptions:", err);
  }
}
