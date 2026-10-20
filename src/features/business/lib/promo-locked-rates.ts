// src/features/business/lib/promo-locked-rates.ts
// The modifier gaps a flat-rate promo keeps after rates change. Pure (no Prisma) so
// client-imported business.ts shares it with promos.ts.

/** One $/hr modifier's delta as it stood when a promo was created. Keyed by label: public rate rows carry no id. */
export interface LockedDelta {
  label: string;
  hourlyDelta: number;
}

/** A $/hr modifier as currently configured. */
export interface LiveDelta {
  label: string;
  hourlyDelta: number | null;
}

/**
 * Normalises a modifier label for matching, as isChannelModifier does.
 * @param label - Rate label as stored.
 * @returns Trimmed, lower-cased label.
 */
function labelKey(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * Every $/hr modifier's current delta, saved on a new promo so a flat promo keeps today's gaps.
 * @param rates - Live rate rows.
 * @returns One entry per modifier carrying an hourly delta.
 */
export function snapshotDeltas(
  rates: { label: string; unit: string; hourlyDelta: number | null }[],
): LockedDelta[] {
  return rates
    .filter((r) => r.unit === "modifier" && r.hourlyDelta !== null)
    .map((r) => ({ label: r.label, hourlyDelta: r.hourlyDelta! }));
}

/**
 * How far a flat promo's price for a modified rate moves off the plain Standard cut: each
 * modifier's locked delta minus its live one. A "lock in current rates" promo set at Standard
 * $65 / At home -$15, read after rates move to $100 / -$30, gives +15, so at-home bills the
 * promised $50 rather than $70 - $35 = $35. Modifiers added after the promo stay at their live delta.
 * @param locked - The promo's saved deltas, or undefined on terms saved before they existed.
 * @param modifiers - The rate's live $/hr modifiers.
 * @returns Dollars to add to the cut rate; 0 when nothing locked has moved.
 */
export function lockedDeltaShift(
  locked: readonly LockedDelta[] | undefined,
  modifiers: readonly LiveDelta[],
): number {
  if (!locked || locked.length === 0) return 0;
  return modifiers.reduce((sum, m) => {
    const lock = locked.find((l) => labelKey(l.label) === labelKey(m.label));
    return lock ? sum + lock.hourlyDelta - (m.hourlyDelta ?? 0) : sum;
  }, 0);
}
