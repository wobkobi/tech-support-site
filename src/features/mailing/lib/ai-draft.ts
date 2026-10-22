// src/features/mailing/lib/ai-draft.ts
// AI draft for a mailing email: draft kinds, the route's reply shape, and how a draft fills
// the block list. Pure and client-safe.

import { emptyBlock, type Block } from "@/features/mailing/lib/blocks";
import { isRenderUrl } from "@/features/social-design/lib/pictures";

/** A kind of email the draft dialog offers, with a line steering the model. */
export interface DraftKind {
  key: string;
  label: string;
  guide: string;
}

/** The kinds the operator can pick by hand. */
const PICKED_KINDS: readonly DraftKind[] = [
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

/** "Let AI decide": the model works the kind out from the brief, using the same guides. */
const AUTO_KIND: DraftKind = {
  key: "auto",
  label: "Let AI decide",
  guide: [
    "Which kind of email is the brief closest to? Write it the way that kind says:",
    ...PICKED_KINDS.map((k) => `- ${k.label}: ${k.guide}`),
    "- None of them fits: write it as a General update.",
  ].join("\n"),
};

/** Kinds in dialog order; the first is the default. */
export const DRAFT_KINDS: readonly DraftKind[] = [AUTO_KIND, ...PICKED_KINDS];

/** The longest brief the dialog accepts. */
export const BRIEF_MAX = 500;

/** The longest brief when it's a social post being turned into an email (Email this too). */
export const POST_SOURCE_MAX = 3000;

/** Where a brief came from: the operator's own words, or a social post to turn into an email. */
export type DraftSource = "brief" | "post";

/**
 * Looks a picture drafted with the email can take; "scam" is the tip look with a warning label,
 * "thanks" the announcement look led by the thank-you.
 */
export const PICTURE_KINDS = ["thanks", "tip", "scam", "promo", "announcement"] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];

/**
 * Whether a value is a {@link PictureKind}.
 * @param value - Raw value.
 * @returns True for a known look.
 */
export function isPictureKind(value: unknown): value is PictureKind {
  return (PICTURE_KINDS as readonly unknown[]).includes(value);
}

/** What the route returns: the parts the editor fills in. */
export interface AiDraft {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  bullets: string[];
  buttonText: string;
  /** Link for a button that has none yet (one of the editor's choices), or "". */
  buttonUrl: string;
  /** The picture look that suits the email, or "" when it doesn't want one or none was asked for. */
  picture: PictureKind | "";
}

/** A saved Post maker picture the draft picked instead of making a new one. */
export interface ReusedPicture {
  url: string;
  alt: string;
  /** The design's name, to say which one went in. */
  name: string;
}

/**
 * Straightens curly quotes and turns en/em dashes into a spaced hyphen, or an unspaced
 * one between digits so a range reads "9-5".
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
 * A trimmed, length-capped string with plain punctuation, or "" when not a string.
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
 * Reads the model's JSON into a draft, dropping wrong-shaped fields and capping lengths
 * so a runaway reply can't flood the editor.
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
    picture: isPictureKind(r.picture) ? r.picture : "",
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
 * Fills a block list from a draft by position, so a template keeps its shape: each part
 * replaces the first matching block (paragraphs swap the Text run after the greeting, so
 * drafting twice doesn't pile up), else is added. Other blocks are left alone.
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

  // Paragraphs: swap the Text run after the greeting, else go under the heading or greeting.
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

/**
 * Puts a drafted picture under the heading (else the greeting). A picture block that's empty
 * or holds a design picture is reused, so drafting again swaps the picture rather than adding
 * another; a photo the operator put in is left alone. When the picture lands right under the
 * email's main heading, that heading is dropped: the picture's headline says the email's point
 * bigger, so the two read as a double. A section heading over a picture further down stays.
 * @param blocks - The blocks.
 * @param picture - The picture.
 * @param picture.url - Its address.
 * @param picture.alt - Its description.
 * @returns The new blocks.
 */
export function placePicture(
  blocks: readonly Block[],
  picture: { url: string; alt: string },
): Block[] {
  const out = [...blocks];
  let at = out.findIndex(
    (b) => b.type === "picture" && (!b.url.trim() || isRenderUrl(b.url.trim())),
  );
  const existing = at >= 0 ? out[at] : null;
  if (existing?.type === "picture") {
    out[at] = { ...existing, url: picture.url, alt: picture.alt };
  } else {
    const heading = out.findIndex((b) => b.type === "heading");
    // findIndex's -1 for no greeting puts the picture first.
    at = heading >= 0 ? heading + 1 : out.findIndex(isGreeting) + 1;
    out.splice(at, 0, { ...emptyBlock("picture"), url: picture.url, alt: picture.alt } as Block);
  }
  if (at > 0 && out.findIndex((b) => b.type === "heading") === at - 1) out.splice(at - 1, 1);
  return out;
}

/**
 * Takes out the picture an earlier draft put in, for a draft that comes without one, so its old
 * words don't sit with the new text. A picture the operator changed since has another address,
 * so it stays.
 * @param blocks - The blocks.
 * @param url - The earlier draft's picture, or null for none.
 * @returns The new blocks.
 */
export function dropPicture(blocks: readonly Block[], url: string | null): Block[] {
  return blocks.filter((b) => !url || b.type !== "picture" || b.url.trim() !== url);
}
