// src/features/business/lib/estimate-range.ts
// Client-safe price-band maths and formatting shared by the pricing wizard, booking-form
// estimate and admin booking views: a point estimate becomes a confidence-scaled low/high band.

import type { EstimateConfidence, EstimatorRange } from "@/shared/lib/settings/types";

/** Minimal rate shape the remote-discount lookup needs (subset of PublicRate). */
interface RemoteRateLike {
  label: string;
  hourlyDelta: number | null;
}

/**
 * The modifiers a meeting mode applies: the first hourly modifier whose label contains
 * "remote" (case-insensitive, so renames survive) for a remote meeting, else none.
 * @param rates - Live public rate rows.
 * @param meeting - Meeting mode; only the literal "remote" applies (in-person spellings vary).
 * @returns The remote modifier in a one-item list, or empty when not applicable.
 */
export function meetingModifiers<T extends RemoteRateLike>(rates: T[], meeting: string): T[] {
  if (meeting !== "remote") return [];
  const remote = rates.find(
    (r) => r.hourlyDelta !== null && r.label.toLowerCase().includes("remote"),
  );
  return remote ? [remote] : [];
}

/**
 * Remote-meeting delta ($/hr, normally negative), from {@link meetingModifiers}.
 * @param rates - Live public rate rows.
 * @param meeting - Meeting mode; only the literal "remote" applies (in-person spellings vary).
 * @returns The remote modifier's hourlyDelta, or 0 when not applicable.
 */
export function remoteRateDelta(rates: RemoteRateLike[], meeting: string): number {
  return meetingModifiers(rates, meeting)[0]?.hourlyDelta ?? 0;
}

/** Low-end floor as a fraction of straight-time cost, so a wide band never advertises half the rate. */
const LOW_END_FLOOR_FACTOR = 0.75;

/**
 * Builds a $5-step low/high band that widens as confidence falls, floored at
 * {@link LOW_END_FLOOR_FACTOR} of straight-time cost and at least the minimum spread wide.
 * @param mins - Billable minutes for this slice (already floored).
 * @param rate - Effective $/hr for labour.
 * @param confidence - How confident the estimate is; selects the band width.
 * @param range - The live, settings-driven confidence band config.
 * @param lowEndFloorFactor - Live low-end floor fraction (defaults to the constant).
 * @returns Whole-dollar `{ low, high }`.
 */
export function priceRangeFor(
  mins: number,
  rate: number,
  confidence: EstimateConfidence,
  range: EstimatorRange,
  lowEndFloorFactor: number = LOW_END_FLOOR_FACTOR,
): { low: number; high: number } {
  const band = range[confidence] ?? range.medium;
  const cost = (mins / 60) * rate;
  // Band low rounds DOWN to $5; the floor rounds to NEAREST so it can't dip under itself.
  const bandLow = Math.floor((cost * band.lowFactor) / 5) * 5;
  const flooredLow = Math.round((cost * lowEndFloorFactor) / 5) * 5;
  const low = Math.max(bandLow, flooredLow);
  const high = Math.max(Math.ceil((cost * band.highFactor) / 5) * 5, low + range.minSpread);
  return { low, high };
}

/**
 * Formats an all-in quote, splitting out travel when positive (labour = total - travel);
 * null or zero travel shows the combined range.
 * @param low - All-in low end of the quoted band, in dollars.
 * @param high - All-in high end of the quoted band, in dollars.
 * @param travel - Round-trip travel slice of the total, or null when unknown.
 * @returns A display string such as "$25 - $55 + $30 travel" or "$55 - $85".
 */
export function formatQuotedRange(low: number, high: number, travel: number | null): string {
  if (travel && travel > 0) {
    return `$${low - travel} - $${high - travel} + $${travel} travel`;
  }
  return `$${low} - $${high}`;
}
