// src/features/admin/components/charts/chart-scale.ts
// Y-axis maths for the admin charts: ticks of 0 / 1,000 / 2,000, not 0 / 1,037 / 2,074.

/** A value axis: its top, the tick step and every tick from 0 up. */
export interface ChartScale {
  top: number;
  step: number;
  ticks: number[];
}

/** Tick steps tried within each power of ten, smallest first. */
const STEP_FACTORS = [1, 2, 2.5, 5, 10] as const;

/**
 * Picks a clean axis for 0 to `max`: the smallest 1/2/2.5/5 x 10^n step within `maxTicks`,
 * always a whole number of `minStep` so ticks can't round together. A max <= 0 returns a 0-1 axis.
 * @param max - The largest value plotted.
 * @param maxTicks - The most ticks wanted, 0 included (default 6).
 * @param minStep - The smallest step: 0.01 for money (whole cents), 1 for counts.
 * @returns The scale.
 */
export function niceScale(max: number, maxTicks = 6, minStep = 0.01): ChartScale {
  if (!(max > 0)) return { top: 1, step: 1, ticks: [0, 1] };
  const rough = max / (maxTicks - 1);
  const pow = 10 ** Math.floor(Math.log10(rough));
  // The filter skips 2.5 x 0.01 for money and 2.5 for counts.
  const step = Math.max(
    minStep,
    STEP_FACTORS.map((f) => f * pow)
      .filter((s) => Math.abs(s / minStep - Math.round(s / minStep)) < 1e-9)
      .find((s) => s >= rough) ?? 10 * pow,
  );
  const count = Math.ceil(max / step - 1e-9);
  const top = Math.round(count * step * 100) / 100;
  // Rebuild each tick from the index; summing the step drifts (0.1 + 0.2).
  const ticks = Array.from({ length: count + 1 }, (_, i) => Math.round(i * step * 100) / 100);
  return { top, step, ticks };
}

/**
 * Axis tick text with thousands commas: whole dollars ("$2,500") unless the tick has
 * cents, which only a sub-$50 axis produces ("$2.50").
 * @param value - Tick value in dollars.
 * @returns The label.
 */
export function formatAxisDollars(value: number): string {
  const digits = Number.isInteger(value) ? 0 : 2;
  return `$${value.toLocaleString("en-NZ", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/**
 * A count with thousands commas ("12,400").
 * @param value - The count.
 * @returns The label.
 */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString("en-NZ");
}
