// scripts/eval-ai/assert.ts
// Pure, network-free expectation maths and tolerance helpers for the eval harness.
// Expected values come from the SAME canonical billing clamp the routes call
// (clampBillableMins), so the auditor tracks the routes without mirroring their code.
// Independent correctness is anchored by the hardcoded constants in the self-test.

import { clampBillableMins } from "@/features/business/lib/pricing-policy";
import type { AiDraft } from "@/features/mailing/lib/ai-draft";

/** Grouping for a reported check. */
type CheckFamily = "context" | "reproducibility" | "drift" | "cross-route" | "travel" | "draft";

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
 * @param ceilingMins - Live hard ceiling on one job's billable minutes.
 * @returns Expected estimatedMins the route would return.
 */
export function expectedEstimateMins(
  benchmarkMins: number,
  minBillableMins: number,
  incrementMins: number,
  ceilingMins: number,
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

/**
 * What a mailing draft got wrong. Hard problems break a rule the prompt states as an
 * INVARIANT (dashes, made-up figures, a greeting or sign-off the template already has,
 * missing paragraphs or button words); soft ones are style the operator fixes in a
 * second (curly quotes, a long subject or button).
 * @param draft - The draft the route returned.
 * @param brief - The brief it was written from.
 * @returns The hard and soft problems, empty when it's clean.
 */
export function draftProblems(draft: AiDraft, brief: string): { hard: string[]; soft: string[] } {
  const hard: string[] = [];
  const soft: string[] = [];
  const all = [
    draft.subject,
    draft.preheader,
    draft.heading,
    ...draft.paragraphs,
    ...draft.bullets,
    draft.buttonText,
  ].join("\n");

  if (/[\u2013\u2014]/.test(all)) hard.push("has an em or en dash");
  // Every digit run outside a {placeholder} has to come from the brief.
  const figures = all.replace(/\{\w+\}/g, "").match(/\d+/g) ?? [];
  const invented = [...new Set(figures)].filter((n) => !brief.includes(n));
  if (invented.length > 0) hard.push(`figures not in the brief: ${invented.join(", ")}`);
  if (draft.paragraphs.length === 0) hard.push("no paragraphs");
  if (/^(hi|hello|hey|kia ora|dear)\b/i.test(draft.paragraphs[0] ?? "")) {
    hard.push("opens with a greeting");
  }
  const last = draft.paragraphs[draft.paragraphs.length - 1] ?? "";
  if (/^(cheers|thanks|regards|kind regards|ng[aā] mihi|warm regards)\b/i.test(last)) {
    hard.push("ends with a sign-off");
  }
  if (!draft.buttonText) hard.push("no button words");

  const words = draft.buttonText.split(/\s+/).filter(Boolean).length;
  if (words > 4) soft.push(`button is ${words} words`);
  if (/[\u2018\u2019\u201c\u201d]/.test(all)) soft.push("curly quotes");
  if (draft.subject.length > 60) soft.push(`subject is ${draft.subject.length} characters`);
  return { hard, soft };
}
