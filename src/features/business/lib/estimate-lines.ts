// src/features/business/lib/estimate-lines.ts
// Fits a quote's per-line minutes to the estimate on the billing grid.

/**
 * Snaps quote lines to the billing grid with at least one step each, then trims or tops up
 * the largest lines one step at a time so they add up to the estimate. Only a quote with more
 * lines than the estimate has steps can end up over it.
 * @param mins - Minutes per line, as estimated.
 * @param target - The whole estimate in minutes (already on the grid).
 * @param increment - Billing step in minutes.
 * @returns Minutes per line, in the same order.
 */
export function fitLinesToTotal(mins: number[], target: number, increment: number): number[] {
  const inc = increment > 0 ? increment : 5;
  const out = mins.map((m) => Math.max(inc, Math.round((m || 0) / inc) * inc));
  /**
   * Index of the largest line, or -1 when none qualifies.
   * @param canShrink - Only consider lines above one step, so none drops below it.
   * @returns The line's index.
   */
  const largest = (canShrink: boolean): number =>
    out.reduce(
      (best, m, i) => ((!canShrink || m > inc) && (best < 0 || m > out[best]!) ? i : best),
      -1,
    );
  let sum = out.reduce((s, m) => s + m, 0);
  while (sum > target) {
    const i = largest(true);
    if (i < 0) break;
    out[i]! -= inc;
    sum -= inc;
  }
  while (sum + inc <= target) {
    out[largest(false)]! += inc;
    sum += inc;
  }
  return out;
}
