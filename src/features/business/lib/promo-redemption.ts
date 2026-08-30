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
