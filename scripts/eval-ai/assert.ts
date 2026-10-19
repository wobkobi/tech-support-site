// scripts/eval-ai/assert.ts
// Network-free expectation maths and tolerances for the eval harness. Expectations use the
// routes' own clampBillableMins; the self-test's hardcoded constants anchor correctness.

import { clampBillableMins } from "@/features/business/lib/pricing-policy";
import type { AiDraft } from "@/features/mailing/lib/ai-draft";
import {
  fromBrief,
  HEADLINE_TARGET,
  type DesignDraft,
  type DraftRoom,
} from "@/features/social-design/lib/ai-draft";

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
 * Expected estimatedMins for one benchmarked task, via the route's own {@link clampBillableMins}.
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
 * Tolerance for a single-task estimate: the larger of one increment or 10% of expected.
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
 * What a mailing draft got wrong. Hard problems break a prompt INVARIANT; soft ones are
 * quick style fixes (curly quotes, a long subject or button).
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

/** A phone number, email address or web address, which a picture never carries. */
const CONTACT_RE = /\b0\d[\d ]{6,}\d\b|@|\bwww\.|https?:\/\/|\.co\.nz\b/i;

/**
 * What a post maker draft got wrong. Hard problems break a prompt INVARIANT; soft ones
 * are style (long headline, curly quotes, hashtags).
 * @param draft - The draft the route returned.
 * @param brief - The brief it was written from.
 * @param room - What the design had room for.
 * @param paidAd - Whether the design was a paid ad.
 * @returns The hard and soft problems, empty when it's clean.
 */
export function postDraftProblems(
  draft: DesignDraft,
  brief: string,
  room: DraftRoom,
  paidAd: boolean,
): { hard: string[]; soft: string[] } {
  const hard: string[] = [];
  const soft: string[] = [];
  const picture = [draft.headline, draft.support, ...draft.bullets].join("\n");
  const all = [picture, draft.quote, draft.name, draft.caption].join("\n");

  if (/[\u2013\u2014]/.test(all)) hard.push("has an em or en dash");
  const figures = picture.match(/\d+/g) ?? [];
  const invented = [...new Set(figures)].filter((n) => !brief.includes(n));
  if (invented.length > 0) hard.push(`picture figures not in the brief: ${invented.join(", ")}`);
  if (CONTACT_RE.test(picture)) hard.push("contact details on the picture");
  if (paidAd && CONTACT_RE.test(draft.caption)) hard.push("contact details in a paid ad's words");
  if (/\b(tap|click) (here|to|below)\b|\blearn more\b|\blink in bio\b/i.test(picture)) {
    hard.push("button-like words on the picture");
  }
  if (!fromBrief(draft.quote, brief)) hard.push("quote has words that aren't in the brief");
  if (!fromBrief(draft.name, brief)) hard.push("name isn't in the brief");
  if (room.headline && !draft.headline) hard.push("no headline");
  if (room.bullets > 0 && draft.bullets.length !== room.bullets) {
    hard.push(`${draft.bullets.length} ticked points, wanted ${room.bullets}`);
  }
  if (!draft.caption) hard.push("no post words");

  const length = draft.headline.replace(/\n/g, " ").length;
  if (length > HEADLINE_TARGET) soft.push(`headline is ${length} characters`);
  if (/[\u2018\u2019\u201c\u201d]/.test(all)) soft.push("curly quotes");
  if (/#\w/.test(draft.caption)) soft.push("hashtags");
  return { hard, soft };
}
