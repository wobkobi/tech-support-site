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
 * "We", "us" or "our": the business is one person, so its words only ever say "I". Case is
 * matched by hand so "US" the country passes.
 */
const PLURAL_RE = /\b(?:[Ww]e(?:'re|'ll|'ve|'d)?|[Uu]s|[Oo]urs?|[Oo]urselves)\b/;

/**
 * Whether the writing says "we", "us" or "our" outside quote marks: a scam text quoted in a
 * warning ("we couldn't deliver your parcel") is someone else's words. A single-quoted span
 * opens after a space or bracket and closes before one or before punctuation, so the
 * apostrophes in "I'm" and "couldn't" don't count as quote marks.
 * @param text - The words to check.
 * @returns True when the business speaks in the plural.
 */
function saysWe(text: string): boolean {
  return PLURAL_RE.test(
    text
      .replace(/["“][^"”\n]*["”]/g, "")
      .replace(/(^|[\s(])['‘][^\n]*?['’](?=[\s.,!?;:)]|$)/gm, "$1"),
  );
}

/**
 * Digit runs the writing made up: in neither the brief nor the business facts the writer was
 * given. Facts match whole runs, so "31" doesn't pass on the "1237" in a phone number.
 * @param text - The words to check, placeholders already removed.
 * @param brief - The brief.
 * @param facts - The /llms.txt facts, or "" for none.
 * @returns The made-up runs.
 */
function inventedFigures(text: string, brief: string, facts: string): string[] {
  const known = new Set(facts.match(/\d+/g) ?? []);
  const runs = new Set(text.match(/\d+/g) ?? []);
  return [...runs].filter((n) => !brief.includes(n) && !known.has(n));
}

/**
 * What a mailing draft got wrong. Hard problems break a prompt INVARIANT; soft ones are
 * quick style fixes (curly quotes, a long subject or button).
 * @param draft - The draft the route returned.
 * @param brief - The brief it was written from.
 * @param facts - The business facts the writer was given (/llms.txt), or "" for none.
 * @returns The hard and soft problems, empty when it's clean.
 */
export function draftProblems(
  draft: AiDraft,
  brief: string,
  facts = "",
): { hard: string[]; soft: string[] } {
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
  if (saysWe(all)) hard.push('says "we", "us" or "our"');
  // Every digit run outside a {placeholder} has to come from the brief or the facts.
  const invented = inventedFigures(all.replace(/\{\w+\}/g, ""), brief, facts);
  if (invented.length > 0) hard.push(`figures not in the brief or facts: ${invented.join(", ")}`);
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
 * @param facts - The business facts the writer was given (/llms.txt), or "" for none.
 * @returns The hard and soft problems, empty when it's clean.
 */
export function postDraftProblems(
  draft: DesignDraft,
  brief: string,
  room: DraftRoom,
  paidAd: boolean,
  facts = "",
): { hard: string[]; soft: string[] } {
  const hard: string[] = [];
  const soft: string[] = [];
  const picture = [draft.headline, draft.support, ...draft.bullets].join("\n");
  const all = [picture, draft.quote, draft.name, draft.caption].join("\n");

  if (/[\u2013\u2014]/.test(all)) hard.push("has an em or en dash");
  // The quote is the customer's words, where "we" is theirs to say.
  if (saysWe([picture, draft.caption].join("\n"))) hard.push('says "we", "us" or "our"');
  const invented = inventedFigures(picture, brief, facts);
  if (invented.length > 0) {
    hard.push(`picture figures not in the brief or facts: ${invented.join(", ")}`);
  }
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
