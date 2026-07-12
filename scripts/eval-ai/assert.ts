// scripts/eval-ai/assert.ts
// Pure, network-free expectation maths and tolerance helpers for the eval
// harness. Mirrors the server-side clamps in
// src/app/api/pricing/estimate-duration/route.ts so expected values stay in
// lockstep with what the route actually enforces.

/** Grouping for a reported check. */
export type CheckFamily = "context" | "reproducibility" | "drift";

/** One reported assertion outcome. */
export interface CheckResult {
  id: string;
  family: CheckFamily;
  label: string;
  status: "pass" | "fail" | "skip" | "info";
  detail: string;
}

/**
 * Expected estimatedMins for a single benchmarked task: snap to the increment,
 * then clamp to [minBillableMins, ceilingMins]. Mirrors the estimate-duration
 * route's server-side clamp exactly.
 * @param benchmarkMins - Standalone benchmark minutes for the task.
 * @param minBillableMins - Live minimum billable floor.
 * @param incrementMins - Live rounding increment.
 * @param ceilingMins - Hard ceiling (defaults to the route's 8h cap).
 * @returns Expected estimatedMins the route would return.
 */
export function expectedEstimateMins(
  benchmarkMins: number,
  minBillableMins: number,
  incrementMins: number,
  ceilingMins = 8 * 60,
): number {
  const inc = incrementMins > 0 ? incrementMins : 5;
  const snapped = Math.round(Math.max(0, benchmarkMins) / inc) * inc;
  return Math.min(ceilingMins, Math.max(minBillableMins, snapped));
}

/**
 * Absolute tolerance for a single-task estimate: one increment or 10% of the
 * expected value, whichever is larger. The model may round scope slightly.
 * @param expected - Expected estimatedMins.
 * @param incrementMins - Live rounding increment.
 * @returns Tolerance in minutes.
 */
export function estimateTolerance(expected: number, incrementMins: number): number {
  return Math.max(incrementMins > 0 ? incrementMins : 5, Math.round(expected * 0.1));
}

/**
 * Whether a measured value sits within +/- tol of the expected value.
 * @param actual - Measured value.
 * @param expected - Expected value.
 * @param tol - Allowed absolute deviation.
 * @returns True when |actual - expected| <= tol.
 */
export function withinTolerance(actual: number, expected: number, tol: number): boolean {
  return Math.abs(actual - expected) <= tol;
}

/**
 * Spread (max - min) across repeated-run values, used for reproducibility.
 * @param values - Numeric results from repeated runs of one case.
 * @returns Difference between the largest and smallest value (0 when empty).
 */
export function spread(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}

/**
 * Sums stated HH:MM time ranges into minutes, rolling a non-positive span over
 * midnight. Mirrors the parse-job route's per-range duration for simple ranges.
 * @param ranges - Stated start/end pairs (24h HH:MM).
 * @returns Total minutes across all ranges.
 */
export function statedSessionMins(ranges: { startTime: string; endTime: string }[]): number {
  return ranges.reduce((sum, r) => {
    const [sh, sm] = r.startTime.split(":").map(Number);
    const [eh, em] = r.endTime.split(":").map(Number);
    let dur = eh * 60 + em - (sh * 60 + sm);
    if (dur <= 0) dur += 24 * 60;
    return sum + dur;
  }, 0);
}
