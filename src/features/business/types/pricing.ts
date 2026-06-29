// src/features/business/types/pricing.ts
/**
 * @description Type definitions for the public pricing estimator - rate and
 * service shapes plus the price-range breakdown (low/high, travel, after-hours,
 * and promo) rendered by the pricing wizard.
 */

export interface PublicRate {
  label: string;
  ratePerHour: number | null;
  flatRate: number | null;
  /** Signed delta added to the base hourly rate when applied (modifier rates only). */
  hourlyDelta: number | null;
  unit: string;
  isDefault: boolean;
}

export interface SelectedService {
  label: string;
  type: "flat" | "hourly";
  flatRate: number | null;
  ratePerHour: number | null;
}

export interface BreakdownLine {
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
  includesAfterHours: boolean;
  /** Pre-promo range, populated only when an active promo discounted the headline. */
  originalLow?: number;
  originalHigh?: number;
  /** Customer-facing label of the active promo, when applied. */
  promoLabel?: string;
}
