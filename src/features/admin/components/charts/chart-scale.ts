// src/features/admin/components/charts/chart-scale.ts
// Y-axis maths for the admin charts: a rounded top value and evenly spaced ticks, so the
// axis reads 0 / 1,000 / 2,000 rather than 0 / 1,037 / 2,074.

/** A value axis: its top, the tick step and every tick from 0 up. */
export interface ChartScale {
  top: number;
  step: number;
  ticks: number[];
}

/** Tick steps tried within each power of ten, smallest first. */
const STEP_FACTORS = [1, 2, 2.5, 5, 10] as const;

/**
 * Picks a clean axis for values from 0 to `max`. The step is the smallest 1/2/2.5/5 x
 * 10^n that keeps the axis to `maxTicks` ticks, and the top is the first step at or
 * above `max`. The step is always a whole number of cents (at least one), so a cents-sized
 * axis can't round two ticks to the same label or draw a gridline off its tick. A max of 0
 * or less returns a 0-1 axis so callers never divide by zero.
 * @param max - The largest value plotted.
 * @param maxTicks - The most ticks wanted, 0 included (default 6).
 * @returns The scale.
 */
export function niceScale(max: number, maxTicks = 6): ChartScale {
  if (!(max > 0)) return { top: 1, step: 1, ticks: [0, 1] };
  const rough = max / (maxTicks - 1);
  const pow = 10 ** Math.floor(Math.log10(rough));
  // 2.5 x 0.01 is the one candidate that isn't whole cents; the filter skips it.
  const step = Math.max(
    0.01,
    STEP_FACTORS.map((f) => f * pow)
      .filter((s) => Math.abs(s * 100 - Math.round(s * 100)) < 1e-9)
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
