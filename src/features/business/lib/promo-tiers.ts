// src/features/business/lib/promo-tiers.ts
// Which discount a job of a given size earns. Kept out of promos.ts (Prisma) because
// client-imported business.ts needs it too.

/** One spend band of a tiered promo. */
export interface PromoTierValues {
  /** Inclusive floor for this band, against the pre-discount total. */
  minSpend: number;
  flatHourlyRate: number | null;
  percentDiscount: number | null;
  fixedAmount: number | null;
  travelPercent: number | null;
}

/** The parts of a promo that a spend threshold acts on. */
export interface SpendGated {
  /** Floor for the pre-discount total, or null when there is none. */
  minSpend?: number | null;
  /** Spend bands; empty or absent is the ordinary single-value promo. */
  tiers?: PromoTierValues[];
  flatHourlyRate: number | null;
  percentDiscount: number | null;
  fixedAmount?: number | null;
  travelPercent?: number | null;
}

/**
 * Narrows a promo to what a job of this size earns: the highest band reached (none = no promo),
 * judged against the LOW end of the pre-discount total so the quote never over-promises.
 * @param promo - The resolved promo, or null.
 * @param preDiscountLow - Low end of the undiscounted total, labour plus travel.
 * @returns The promo with its earned values, or null when the job earns nothing.
 */
export function promoForSpend<T extends SpendGated>(
  promo: T | null,
  preDiscountLow: number,
): T | null {
  if (!promo) return null;
  if (promo.minSpend != null && preDiscountLow < promo.minSpend) return null;
  const tiers = promo.tiers ?? [];
  if (tiers.length === 0) return promo;

  // Order-independent; validation rejects duplicate floors, so there is one winner.
  const earned = tiers.reduce<PromoTierValues | null>((best, tier) => {
    if (preDiscountLow < tier.minSpend) return best;
    return best === null || tier.minSpend > best.minSpend ? tier : best;
  }, null);
  if (!earned) return null;

  // The band replaces the promo's columns wholesale, so a half-filled tier inherits nothing.
  return {
    ...promo,
    flatHourlyRate: earned.flatHourlyRate,
    percentDiscount: earned.percentDiscount,
    fixedAmount: earned.fixedAmount,
    travelPercent: earned.travelPercent,
  };
}
