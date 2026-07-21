// src/features/business/lib/estimate-range.ts
/**
 * @description Shared, client-safe price-range math for the public estimator.
 * Turns a point time estimate + hourly rate into a customer-facing low/high
 * band whose width scales with the AI's confidence. Used by both the pricing
 * page wizard and the inline booking-form estimate so the two never drift.
 */

import type { EstimateConfidence, EstimatorRange } from "@/shared/lib/settings/types";

/** Minimal rate shape the remote-discount lookup needs (subset of PublicRate). */
interface RemoteRateLike {
  label: string;
  hourlyDelta: number | null;
}

/**
 * Resolves the remote-meeting discount delta ($/hr, normally negative) from the
 * live public rates. Matches any hourly modifier whose label contains "remote"
 * (case-insensitive) rather than the exact string "Remote", so renaming the
 * rate to e.g. "Remote support" still applies the discount; only a rename that
 * drops the word "remote" entirely would miss it. The base rate (keyed off
 * isDefault) and travel rate (keyed off unit) already survive renames - this
 * keeps the remote modifier in step. Returns 0 for in-person meetings or when
 * no remote modifier exists, so the caller just adds it to the base rate.
 * @param rates - Live public rate rows.
 * @param meeting - Meeting mode; only the literal "remote" applies the discount (callers spell in-person differently: "on-site" vs "in-person").
 * @returns The remote modifier's hourlyDelta, or 0 when not applicable.
 */
export function remoteRateDelta(rates: RemoteRateLike[], meeting: string): number {
  if (meeting !== "remote") return 0;
  const remote = rates.find(
    (r) => r.hourlyDelta !== null && r.label.toLowerCase().includes("remote"),
  );
  return remote?.hourlyDelta ?? 0;
}

/**
 * Hard floor on the low end as a fraction of straight-time cost - a guard
 * rail, not a tuning knob (the band in Settings stays tunable). Stops a wide
 * low-confidence band advertising roughly half the hourly rate.
 */
export const LOW_END_FLOOR_FACTOR = 0.75;

/**
 * Builds a whole-dollar low/high price band for one visit slice. The band
 * widens (and the low end drops faster than the high end rises) as confidence
 * falls; it rounds to the nearest $5, never falls below
 * {@link LOW_END_FLOOR_FACTOR} of straight-time cost, and is never narrower
 * than the configured minimum spread.
 * @param mins - Billable minutes for this slice (already floored).
 * @param rate - Effective $/hr for labour.
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
  // Band low rounds DOWN to $5; the floor rounds to NEAREST - rounding the
  // floor down too would push it back under the guarantee it enforces.
  const bandLow = Math.floor((cost * band.lowFactor) / 5) * 5;
  const flooredLow = Math.round((cost * LOW_END_FLOOR_FACTOR) / 5) * 5;
  const low = Math.max(bandLow, flooredLow);
  const high = Math.max(Math.ceil((cost * band.highFactor) / 5) * 5, low + range.minSpread);
  return { low, high };
}
