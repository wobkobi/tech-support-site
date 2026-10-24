// src/features/business/lib/gold-card.ts
// The Gold Card discount's size, read from the "Gold Card" row in Settings > Rates. The
// row is a percent modifier the calculator never attaches to a task: the Gold Card tick
// box applies it to the whole job's labour through calcJobTotal instead.

import type { RateConfig } from "@/features/business/types/business";

/**
 * Whether a rate row is the Gold Card modifier.
 * @param rate - Rate row to check.
 * @returns True for a percent modifier labelled "Gold Card", in any case.
 */
export function isGoldCardRate(rate: Pick<RateConfig, "label" | "unit" | "percentDelta">): boolean {
  return (
    rate.unit === "modifier" &&
    rate.percentDelta != null &&
    rate.label.trim().toLowerCase() === "gold card"
  );
}

/**
 * The Gold Card's share off labour. The row's sign is ignored, so -10% and +10% both mean
 * 10% off; it's capped at 100%.
 * @param rates - Live rate list.
 * @returns The fraction off (0.1 = 10%), or null when there's no usable row, which hides the box.
 */
export function goldCardPercent(
  rates: readonly Pick<RateConfig, "label" | "unit" | "percentDelta">[],
): number | null {
  const row = rates.find(isGoldCardRate);
  const percent = Math.min(1, Math.abs(row?.percentDelta ?? 0));
  return percent > 0 ? percent : null;
}
