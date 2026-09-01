// src/features/business/lib/promo-redemption.ts
// Records one use of a promo. Bookkeeping only: it never throws, because a
// customer's booking must not depend on analytics succeeding.

import { prisma } from "@/shared/lib/prisma";

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
 * Records a promo redemption, swallowing every error. Callers await this only
 * so it runs before Vercel freezes the instance, never so its result can block
 * them.
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
 * Records what a promo was really worth, once an invoice says so.
 *
 * A booked job already recorded a redemption at booking time with no value -
 * the discount is not known until the work is priced. That row is updated
 * rather than a second one written, so one job is one redemption and a cap
 * counts jobs rather than touchpoints. A job that never came from a booking
 * (walk-up, phone) has no row yet and gets one here, which is also what makes
 * calculator jobs count toward a cap at all.
 *
 * Bookkeeping only: it never throws, because saving an invoice must not fail
 * over analytics.
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
      return;
    }

    await prisma.promoRedemption.create({
      data: {
        promoId: input.promoId,
        bookingId: input.bookingId ?? null,
        invoiceId: input.invoiceId,
        contactId: input.contactId ?? null,
        discountValue: input.discountValue,
      },
    });
  } catch (err) {
    console.error("[promos] Failed to settle redemption:", err);
  }
}
