// src/features/business/lib/promo-tiers.ts
// Which discount a job of a given size earns. Kept out of promos.ts because the
// invoice calculator needs this rule too, and promos.ts carries the Prisma
// client - business.ts is imported by client components and must not.

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
 * Narrows a promo to what a job of this size actually earns.
 *
 * Two rules, both from the spec and both easy to get backwards:
 *
 * A tiered promo takes the highest band the job reaches. Reaching none means
 * the promo does not apply at all, rather than falling back to a smaller
 * discount the operator never offered.
 *
 * Bands and `minSpend` are judged against the LOW end of the pre-discount
 * total. A job quoted $90-$140 sits below a $100 threshold at one end and above
 * it at the other; taking the low end quotes the discount the customer is
 * certain to get, and a job that lands higher simply earns more at invoice
 * time. Taking the high end would advertise a discount the job may not reach,
 * which is the same failure as a quote that comes in over.
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

  // Reduced rather than sorted: resolution must not depend on the stored order,
  // and validation already rejects duplicate floors so there is one winner.
  const earned = tiers.reduce<PromoTierValues | null>((best, tier) => {
    if (preDiscountLow < tier.minSpend) return best;
    return best === null || tier.minSpend > best.minSpend ? tier : best;
  }, null);
  if (!earned) return null;

  // The band replaces the promo's own columns wholesale. Merging them would let
  // a half-filled tier silently inherit the parent's value and discount by an
  // amount that appears in neither.
  return {
    ...promo,
    flatHourlyRate: earned.flatHourlyRate,
    percentDiscount: earned.percentDiscount,
    fixedAmount: earned.fixedAmount,
    travelPercent: earned.travelPercent,
  };
}
