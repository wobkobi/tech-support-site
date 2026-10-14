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
}

/**
 * A trimmed string field, or "" when missing or not a string, cut to a length.
 * @param value - Raw value.
 * @param max - Longest allowed.
 * @returns The string.
 */
function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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
 * lengths so a runaway reply can't flood the editor. The wording itself is left as
 * written: the operator reads every draft before it goes anywhere.
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
 * - the first paragraph replaces the first Text block after the greeting, and any
 *   further paragraphs go in as new Text blocks under it,
 * - the bullets replace the first Bullet list's points,
 * - the button words replace the first Button's words, keeping its link.
 * A part with no block to go in is added: a heading under the greeting, the paragraphs
 * under that, a list under the paragraphs and a button (with no link yet) at the end.
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

  // Paragraphs: the first Text after the greeting, then new ones under it. With none to
  // replace, they start under the heading (or the greeting).
  let lastParagraph = Math.max(greeting, heading);
  if (draft.paragraphs.length > 0) {
    const first = out.findIndex((b, i) => i > greeting && b.type === "text");
    const [lead, ...rest] = draft.paragraphs;
    let at: number;
    if (first >= 0) {
      out[first] = { ...out[first], text: lead } as Block;
      at = first;
    } else {
      at = lastParagraph + 1;
      out.splice(at, 0, { ...emptyBlock("text"), text: lead } as Block);
    }
    for (const paragraph of rest) {
      at += 1;
      out.splice(at, 0, { ...emptyBlock("text"), text: paragraph } as Block);
    }
    lastParagraph = at;
  }

  if (draft.bullets.length > 0) {
    const listAt = out.findIndex((b) => b.type === "list");
    if (listAt >= 0) out[listAt] = { ...out[listAt], items: draft.bullets } as Block;
    else out.splice(lastParagraph + 1, 0, { ...emptyBlock("list"), items: draft.bullets } as Block);
  }

  if (draft.buttonText) {
    const buttonAt = out.findIndex((b) => b.type === "button");
    if (buttonAt >= 0) out[buttonAt] = { ...out[buttonAt], label: draft.buttonText } as Block;
    else out.push({ ...emptyBlock("button"), label: draft.buttonText } as Block);
  }

  return out;
}
