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
import type { CaptionRequest } from "@/features/social/lib/caption-ai";
import {
  firstName,
  replyLength,
  replyLimit,
  type ReplyRequest,
} from "@/features/social/lib/inbox/map";
import { GOOGLE_MAX_CHARS } from "@/features/social/lib/validate";

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

/** A hashtag: # then letters, numbers or _, not inside a word or an HTML entity. */
const HASHTAG_RE = /(?<![\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu;
/** One emoji (any pictograph, so a skin tone or joiner sequence counts once per symbol). */
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
/** An NZ phone number or an email address, which a Google post must never carry. */
const PHONE_RE = /\b0\d[\d ]{6,}\d\b/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;

/**
 * Lowercased hashtags in the order they appear.
 * @param text - The words to read.
 * @returns The hashtags, # included.
 */
function hashtagsIn(text: string): string[] {
  return (text.match(HASHTAG_RE) ?? []).map((t) => t.toLowerCase());
}

/**
 * What a set of Write with AI options got wrong. Hard problems break a prompt INVARIANT;
 * soft ones are style. Option problems are prefixed with the option number when there are
 * several. In a rewrite, hashtags and emoji are measured against the post's own words.
 * @param captions - The options the route returned.
 * @param req - The request as the route parsed it.
 * @param facts - The business facts the writer was given (/llms.txt), or "" for none.
 * @param brand - The live brand profile's hashtags (no #) and Never mention words.
 * @param brand.tags - Brand hashtags, which must open the hashtag line.
 * @param brand.avoid - Words or topics that must never appear.
 * @returns The hard and soft problems, empty when it's clean.
 */
export function captionProblems(
  captions: string[],
  req: CaptionRequest,
  facts: string,
  brand: { tags: string[]; avoid: string[] },
): { hard: string[]; soft: string[] } {
  const hard: string[] = [];
  const soft: string[] = [];
  if (captions.length !== req.count) {
    hard.push(`${captions.length} option(s), wanted ${req.count}`);
  }
  const rewrite = req.mode === "rewrite";
  const writesEnding = !rewrite || req.action === "cta";
  const writesTags = rewrite ? req.action === "hashtags" : req.hashtags;
  const briefTags = new Set(hashtagsIn(req.brief));
  const briefEmoji = rewrite ? (req.brief.match(EMOJI_RE) ?? []).length : 0;
  const maxEmoji = briefEmoji + (req.emoji && req.action !== "fix" ? 2 : 0);
  const brandTags = brand.tags.map((t) => `#${t.toLowerCase()}`);
  const google = req.platforms.includes("google");

  captions.forEach((text, i) => {
    const bad: string[] = [];
    const style: string[] = [];
    const tags = hashtagsIn(text);

    if (/[\u2013\u2014]/.test(text)) bad.push("has an em or en dash");
    if (saysWe(text)) bad.push('says "we", "us" or "our"');
    if (/\*\*|^#+ /m.test(text)) bad.push("has markup");
    // Digit runs outside placeholders and hashtags come from the brief or the facts.
    const invented = inventedFigures(
      text.replace(/\{\w+\}/g, "").replace(HASHTAG_RE, ""),
      req.brief,
      facts,
    );
    if (invented.length > 0) bad.push(`figures not in the brief or facts: ${invented.join(", ")}`);

    if (writesTags) {
      if (tags.length === 0) bad.push("no hashtags");
      if (tags.length > 10) bad.push(`${tags.length} hashtags, at most 10`);
      if (brandTags.length > 0 && brandTags.some((t, n) => tags[n] !== t)) {
        bad.push("brand hashtags don't open the hashtag line");
      }
    } else {
      const added = tags.filter((t) => !briefTags.has(t));
      if (added.length > 0) bad.push(`hashtags it shouldn't add: ${added.join(" ")}`);
    }

    const emoji = (text.match(EMOJI_RE) ?? []).length;
    if (emoji > maxEmoji) bad.push(`${emoji} emoji, at most ${maxEmoji}`);
    if (req.action === "fix" && emoji < briefEmoji) style.push("dropped an emoji");

    if (google && (PHONE_RE.test(text) || EMAIL_RE.test(text))) {
      bad.push("phone or email in words for Google");
    }
    if (google && text.length > GOOGLE_MAX_CHARS) {
      bad.push(`${text.length} characters, Google takes ${GOOGLE_MAX_CHARS}`);
    }
    if (req.platforms.includes("instagram") && /link in bio|click the link|tap below/i.test(text)) {
      bad.push("points to a link Instagram can't tap");
    }
    if (writesEnding && req.ending === "book") {
      const links = (text.match(/\/booking\b/g) ?? []).length;
      if (links !== 1) bad.push(`booking link appears ${links} times, wanted once`);
    }
    if (writesEnding && req.ending === "call" && !google && !PHONE_RE.test(text)) {
      bad.push("call ending with no phone number");
    }
    // "In any form", so a plain substring: "cheap" also catches "cheaper".
    const lower = text.toLowerCase();
    for (const word of brand.avoid) {
      if (lower.includes(word.toLowerCase())) bad.push(`says "${word}" (Never mention)`);
    }

    const at = captions.length > 1 ? `option ${i + 1}: ` : "";
    hard.push(...bad.map((p) => at + p));
    soft.push(...style.map((p) => at + p));
  });

  // Options should take different angles, so two opening the same way is worth a look.
  const openings = captions.map((c) => c.toLowerCase().split(/\s+/).slice(0, 3).join(" "));
  if (new Set(openings).size < openings.length) soft.push("options open the same way");
  return { hard, soft };
}

/** Words that give money back or knock money off, which a review reply must never offer. */
const MONEY_BACK_RE = /\brefund|\bdiscount|\bmoney back|\bfree of charge|\bfor free\b|\bcompensat/i;

/**
 * What a Suggest a reply answer got wrong. Hard problems break a prompt INVARIANT; soft ones are
 * style. Spam must come back as `hide` with no words; anything else as words to send.
 * @param got - The suggestion the route returned.
 * @param got.reply - The words.
 * @param got.hide - Whether it says to hide the message.
 * @param req - The request as the route parsed it.
 * @param facts - The business facts the writer was given (/llms.txt).
 * @param opts - What the case expects.
 * @param opts.wantHide - It's spam: the answer must say hide.
 * @param opts.allowHide - Hide is a fair answer as well as words.
 * @param opts.noEmoji - It's serious (a worry, a problem or a price): no emoji at all.
 * @param opts.wantEmoji - It's casual: a reply with no emoji is a style note.
 * @returns The hard and soft problems, empty when it's clean.
 */
export function replyProblems(
  got: { reply: string; hide: boolean },
  req: ReplyRequest,
  facts: string,
  opts: { wantHide?: boolean; allowHide?: boolean; noEmoji?: boolean; wantEmoji?: boolean } = {},
): { hard: string[]; soft: string[] } {
  const hard: string[] = [];
  const soft: string[] = [];
  const text = got.reply;
  if (opts.wantHide) {
    if (!got.hide) hard.push("spam not marked to hide");
    if (text) soft.push("spam came back with words as well");
    return { hard, soft };
  }
  if (got.hide && !opts.allowHide) hard.push("marked to hide, but it isn't spam");
  if (!text) {
    if (!got.hide) hard.push("no words came back");
    return { hard, soft };
  }

  if (/[–—]/.test(text)) hard.push("has an em or en dash");
  if (saysWe(text)) hard.push('says "we", "us" or "our"');
  if (/\*\*|^#+ /m.test(text)) hard.push("has markup");
  if (hashtagsIn(text).length > 0) hard.push("has hashtags");
  // Emoji only in a casual reply: none on a review under 4 stars or a serious case, two at most.
  const emoji = (text.match(EMOJI_RE) ?? []).length;
  const lowReview = req.kind === "review" && (req.rating ?? 0) < 4;
  if ((lowReview || opts.noEmoji) && emoji > 0) hard.push("has emoji where it shouldn't");
  else if (emoji > 2) hard.push(`${emoji} emoji, two at most`);
  if (opts.wantEmoji && emoji === 0) soft.push("no emoji in a casual reply");
  // The slack covers the full stop and space between a link and a trailing emoji.
  if (
    /(?:https?:\/\/\S+|\d{3}[\s-]?\d{3,4}|\$\d+)[^\n]{0,3}\p{Extended_Pictographic}/u.test(text)
  ) {
    soft.push("emoji straight after a link, number or price");
  }
  // No first name means a username: no word of it may come back as their name.
  if (req.author && !firstName(req.platform, req.author)) {
    const used = req.author
      .split(/[^\p{L}]+/u)
      .filter((part) => part.length >= 3)
      .map((part) => part[0].toUpperCase() + part.slice(1).toLowerCase())
      .find((part) => new RegExp(`\\b${part}\\b`, "u").test(text));
    if (used) hard.push(`calls them "${used}" from their username`);
  }
  const direct = req.kind === "message";
  const max = replyLimit(req.platform, direct);
  const length = replyLength(req.platform, direct, text);
  if (length > max) hard.push(`${length} characters, ${req.platform} takes ${max}`);
  const said = [req.text, req.postText ?? "", ...req.earlier.map((m) => m.text)].join("\n");
  const invented = inventedFigures(text, said, facts);
  if (invented.length > 0) hard.push(`figures not in the thread or facts: ${invented.join(", ")}`);
  // Links work in Instagram messages, just not in comments.
  if (req.platform === "instagram" && !direct && /https?:\/\/|\bwww\.|\.co\.nz\b/i.test(text)) {
    hard.push("a link Instagram can't tap");
  }

  // A sentence ends at . ! or ? followed by a space or the end.
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim()).length;
  // A 4 or 5 star review gets a short thanks; a lower one room to say sorry and give the phone.
  const praise = req.kind === "review" && (req.rating ?? 0) >= 4;
  const most = praise ? 2 : req.kind === "review" ? 4 : direct ? 3 : 2;
  if (sentences > most + 1) hard.push(`${sentences} sentences, at most ${most}`);
  else if (sentences > most) soft.push(`${sentences} sentences, at most ${most}`);
  if (req.kind === "review" && !praise && sentences < 2) soft.push("one sentence for a review");
  const words = text.split(/\s+/).filter(Boolean).length;
  if (praise && words > 35) soft.push(`${words} words, a thanks takes 35 at most`);

  if (req.kind === "review" && req.rating !== null) {
    const name = firstName("google", req.author);
    if (req.rating >= 4 && name && !text.includes(name)) hard.push(`doesn't thank ${name} by name`);
    if (req.rating <= 3) {
      if (!/sorry|apolog/i.test(text)) hard.push("doesn't apologise");
      if (!PHONE_RE.test(text)) hard.push("doesn't give the phone number");
    }
    if (MONEY_BACK_RE.test(text)) hard.push("offers money back or a discount");
  }
  if (/[‘’“”]/.test(text)) soft.push("curly quotes");
  return { hard, soft };
}
