// scripts/eval-ai/assert.ts
// Pure, network-free expectation maths and tolerance helpers for the eval
// harness. Expected values come from the SAME canonical billing clamp the
// routes call (clampBillableMins), so the auditor tracks the routes without
// mirroring their code. Independent correctness is anchored by the hardcoded
// canonical constants in the self-test (see index.ts).

import { clampBillableMins, MAX_JOB_MINS } from "@/features/business/lib/pricing-policy";

/** Grouping for a reported check. */
export type CheckFamily = "context" | "reproducibility" | "drift" | "cross-route";

/** One reported assertion outcome. */
export interface CheckResult {
  id: string;
  family: CheckFamily;
  label: string;
  status: "pass" | "fail" | "skip" | "info";
  detail: string;
}

/**
 * Expected estimatedMins for a single benchmarked task: the shared
 * {@link clampBillableMins} applied to the benchmark, so the expectation uses
 * the exact clamp the estimate-duration route now calls.
 * @param benchmarkMins - Standalone benchmark minutes for the task.
 * @param minBillableMins - Live minimum billable floor.
 * @param incrementMins - Live rounding increment.
 * @param ceilingMins - Hard ceiling (defaults to the shared 8h cap).
 * @returns Expected estimatedMins the route would return.
 */
export function expectedEstimateMins(
  benchmarkMins: number,
  minBillableMins: number,
  incrementMins: number,
  ceilingMins = MAX_JOB_MINS,
): number {
  return clampBillableMins(benchmarkMins, minBillableMins, incrementMins, ceilingMins);
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
