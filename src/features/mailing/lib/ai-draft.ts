// src/features/mailing/lib/ai-draft.ts
// The AI draft for a mailing email: what kinds of email it can write, the shape the
// route returns, and how a draft fills the block list. Pure and client-safe, so the
// editor and the checks share it.

import { emptyBlock, type Block } from "@/features/mailing/lib/blocks";

/** A kind of email the draft dialog offers, with a line steering the model. */
export interface DraftKind {
  key: string;
  label: string;
  guide: string;
}

/** Kinds in dialog order; the first is the default. */
export const DRAFT_KINDS: readonly DraftKind[] = [
  {
    key: "general",
    label: "General update",
    guide: "A short update about the business: what's happening and what it means for the reader.",
  },
  {
    key: "promo",
    label: "Promo",
    guide:
      "Telling past customers about the current deal. The promo card shows the offer and end date, so describe what the deal is good for, not its figures.",
  },
  {
    key: "tip",
    label: "Tech tip",
    guide: "One practical tip the reader can do themselves, with the steps as bullet points.",
  },
  {
    key: "announcement",
    label: "Announcement",
    guide: "Something new: a service, an area, hours or a change the reader should know about.",
  },
  {
    key: "checking-in",
    label: "Checking in",
    guide:
      "A friendly check-in with people who haven't booked in a while, naming everyday problems they might have now.",
  },
  {
    key: "scam-warning",
    label: "Scam warning",
    guide:
      "A warning about a scam going around: what it looks like, how to spot it (as bullet points) and what to do if they've been caught.",
  },
];

/** The longest brief the dialog accepts. */
export const BRIEF_MAX = 500;

/** What the route returns: the parts the editor fills in. */
export interface AiDraft {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  bullets: string[];
  buttonText: string;
  /**
   * Where a button with no link yet should go: one of the editor's link choices, or ""
   * to leave the link for the operator. Ignored when the button already has a link.
   */
  buttonUrl: string;
}

/**
 * Straightens the typography the prompt bans but the model still slips in now and
 * then: curly quotes become straight ones, and an en or em dash becomes a spaced
 * hyphen (an unspaced one between digits, so a range reads "9-5"). Only punctuation
 * changes; the words stay as written.
 * @param value - Model text.
 * @returns The text with plain punctuation.
 */
export function plainPunctuation(value: string): string {
  return value
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2")
    .replace(/\s*[–—]\s*/g, " - ");
}

/**
 * A trimmed string field with plain punctuation, or "" when missing or not a string,
 * cut to a length.
 * @param value - Raw value.
 * @param max - Longest allowed.
 * @returns The string.
 */
function text(value: unknown, max: number): string {
  return typeof value === "string" ? plainPunctuation(value.trim()).trim().slice(0, max) : "";
}

/**
 * A list of non-empty strings, capped in count and length.
 * @param value - Raw value.
 * @param count - Most items kept.
 * @param max - Longest item.
 * @returns The items.
 */
function list(value: unknown, count: number, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => text(v, max))
    .filter(Boolean)
    .slice(0, count);
}

/**
 * Reads the model's JSON into a draft, dropping anything the wrong shape and capping
 * lengths so a runaway reply can't flood the editor. Beyond straightening quotes and
 * dashes the wording is left as written: the operator reads every draft before it
 * goes anywhere.
 * @param raw - Parsed JSON from the model.
 * @returns The draft, or null when it has nothing to fill in.
 */
export function readDraft(raw: unknown): AiDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const draft: AiDraft = {
    subject: text(r.subject, 150),
    preheader: text(r.preheader, 150),
    heading: text(r.heading, 120),
    paragraphs: list(r.paragraphs, 5, 800),
    bullets: list(r.bullets, 8, 200),
    buttonText: text(r.buttonText, 40),
    buttonUrl: text(r.buttonUrl, 300),
  };
  return draft.paragraphs.length > 0 || draft.heading ? draft : null;
}

/** A greeting line on its own, like "Hi {firstName}," or "Kia ora {firstName}". */
const GREETING_RE = /^(hi|hello|hey|kia ora|dear)\b[^\n]*$/i;

/**
 * Whether a block is the greeting.
 * @param block - The block.
 * @returns True for a one-line Text block that opens with a greeting.
 */
function isGreeting(block: Block): boolean {
  return block.type === "text" && GREETING_RE.test(block.text.trim());
}

/**
 * Fills a block list from a draft, by position, so a template's layout keeps its shape:
 * - the heading goes in the first Heading block,
 * - the paragraphs replace the run of Text blocks that starts at the first one after the
 *   greeting (all of them up to the next other block), so drafting into an email that
 *   already has words, or drafting twice, swaps them rather than piling up,
 * - the bullets replace the first Bullet list's points,
 * - the button words replace the first Button's words, keeping its link; a button with
 *   no link yet takes the draft's link.
 * A part with no block to go in is added: a heading under the greeting, the paragraphs
 * under that, a list under the paragraphs and a button at the end.
 * A missing greeting is added at the top. Pictures, quotes, the promo card and every
 * other block stay as they were.
 * @param blocks - The current blocks.
 * @param draft - The draft.
 * @returns The new blocks.
 */
export function fillBlocks(blocks: readonly Block[], draft: AiDraft): Block[] {
  const out = [...blocks];

  let greeting = out.findIndex(isGreeting);
  if (greeting < 0) {
    out.unshift({ ...emptyBlock("text"), text: "Hi {firstName}," } as Block);
    greeting = 0;
  }

  // Heading: the first one, wherever it is; else straight under the greeting.
  let heading = out.findIndex((b) => b.type === "heading");
  if (draft.heading) {
    if (heading >= 0) {
      out[heading] = { ...out[heading], text: draft.heading } as Block;
    } else {
      heading = greeting + 1;
      out.splice(heading, 0, { ...emptyBlock("heading"), text: draft.heading } as Block);
    }
  }

  // Paragraphs: swap out the run of Text blocks from the first one after the greeting.
  // With none to replace, they start under the heading (or the greeting).
  let lastParagraph = Math.max(greeting, heading);
  if (draft.paragraphs.length > 0) {
    const first = out.findIndex((b, i) => i > greeting && b.type === "text");
    let start = lastParagraph + 1;
    let runLength = 0;
    if (first >= 0) {
      start = first;
      while (out[start + runLength]?.type === "text") runLength += 1;
    }
    const paragraphs = draft.paragraphs.map(
      (paragraph) => ({ ...emptyBlock("text"), text: paragraph }) as Block,
    );
    // Keep the first replaced block's id so focus and the card's place in the list hold.
    if (runLength > 0) paragraphs[0] = { ...out[start], text: draft.paragraphs[0] } as Block;
    out.splice(start, runLength, ...paragraphs);
    lastParagraph = start + paragraphs.length - 1;
  }

  if (draft.bullets.length > 0) {
    const listAt = out.findIndex((b) => b.type === "list");
    if (listAt >= 0) out[listAt] = { ...out[listAt], items: draft.bullets } as Block;
    else out.splice(lastParagraph + 1, 0, { ...emptyBlock("list"), items: draft.bullets } as Block);
  }

  if (draft.buttonText) {
    const buttonAt = out.findIndex((b) => b.type === "button");
    const existing = buttonAt >= 0 ? out[buttonAt] : null;
    if (existing?.type === "button") {
      out[buttonAt] = {
        ...existing,
        label: draft.buttonText,
        url: existing.url || draft.buttonUrl,
      };
    } else {
      out.push({ ...emptyBlock("button"), label: draft.buttonText, url: draft.buttonUrl } as Block);
    }
  }

  return out;
}
