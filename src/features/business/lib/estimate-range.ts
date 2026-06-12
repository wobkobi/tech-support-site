// src/features/business/lib/estimate-range.ts
/**
 * @file estimate-range.ts
 * @description Shared, client-safe price-range math for the public estimator.
 * Turns a point time estimate + hourly rate into a customer-facing low/high
 * band whose width scales with the AI's confidence. Used by both the pricing
 * page wizard and the inline booking-form estimate so the two never drift.
 */

import type { EstimateConfidence, EstimatorRange } from "@/shared/lib/settings/types";

/**
 * Builds a whole-dollar low/high price band for one visit slice. The band
 * widens (and the low end drops faster than the high end rises) as confidence
 * falls; it rounds to the nearest $5 and is never narrower than the configured
 * minimum spread.
 * @param mins - Billable minutes for this slice (already floored).
 * @param rate - Effective $/h for labour.
 * @param confidence - How confident the estimate is; selects the band width.
 * @param range - The live, settings-driven confidence band config.
 * @returns Whole-dollar `{ low, high }`.
 */
export function priceRangeFor(
  mins: number,
  rate: number,
  confidence: EstimateConfidence,
  range: EstimatorRange,
): { low: number; high: number } {
  const band = range[confidence] ?? range.medium;
  const cost = (mins / 60) * rate;
  const low = Math.floor((cost * band.lowFactor) / 5) * 5;
  const high = Math.max(Math.ceil((cost * band.highFactor) / 5) * 5, low + range.minSpread);
  return { low, high };
}
