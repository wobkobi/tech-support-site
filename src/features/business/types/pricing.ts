// src/features/business/types/pricing.ts
// Types for the public pricing estimator: rates and the price-range breakdown.

export interface PublicRate {
  label: string;
  ratePerHour: number | null;
  flatRate: number | null;
  /** Signed delta added to the base hourly rate when applied (modifier rates only). */
  hourlyDelta: number | null;
  unit: string;
  isDefault: boolean;
}

interface BreakdownLine {
  label: string;
  low: number;
  high: number;
  note: string | null;
}

export interface PriceRange {
  low: number;
  high: number;
  breakdown: BreakdownLine[];
  includesTravel: boolean;
  /** Round-trip drive charge applied ($), so the "minimum" note shows only when floored. */
  travelCharge?: number;
  includesAfterHours: boolean;
  /** Pre-promo range, populated only when an active promo discounted the headline. */
  originalLow?: number;
  originalHigh?: number;
  /** Pre-promo travel charge; a free-travel promo zeroes travelCharge but not this. */
  originalTravel?: number;
  /** Customer-facing label of the active promo, when applied. */
  promoLabel?: string;
}
