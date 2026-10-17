// src/features/social-design/lib/ai-draft.ts
// The AI draft for a post maker design: the kinds of post it writes, what room a design
// has for words, reading the model's reply, and filling a draft into the layers by role.
// Pure and client-safe, so the editor, the route and the checks share it.

import { plainPunctuation } from "@/features/mailing/lib/ai-draft";
import type { DesignKind } from "@/features/social-design/lib/design-row";
import type { DesignDoc, Layer, LayerRole } from "@/features/social-design/lib/doc";

/** The longest brief the dialog accepts. */
export const POST_BRIEF_MAX = 500;
/** Headline length the prompt asks for: the ads guide's limit for words read as a thumbnail. */
export const HEADLINE_TARGET = 30;
/** Most ticked points a draft writes; more stop reading at phone size. */
export const MAX_DRAFT_BULLETS = 4;

/** A kind of post the dialog offers, with a line steering the model. */
export interface PostDraftKind {
  key: string;
  label: string;
  guide: string;
  /** Example brief shown in the empty box. */
  example: string;
}

/** Kinds in dialog order. */
export const POST_DRAFT_KINDS: readonly PostDraftKind[] = [
  {
    key: "announcement",
    label: "Announcement",
    guide:
      "Something new or worth knowing: a service, an area, hours or a change. The headline says the news itself, not that there is news.",
    example: "I'm now doing home visits in Titirangi and Laingholm, Tuesdays and Thursdays.",
  },
  {
    key: "tip",
    label: "Tech tip",
    guide:
      'One practical tip the reader can do themselves. The headline names the problem or the win ("Speed up a slow laptop"); the ticked points are the steps or the signs.',
    example: "How to tell a fake parcel text from a real one.",
  },
  {
    key: "review",
    label: "Review",
    guide:
      "Sharing a review a customer left. The picture shows their own words; the post words thank them and say what the job was, only as far as the brief says.",
    example:
      "Paste the review word for word, then who left it, like: Margaret, Titirangi. Nothing else gets made up.",
  },
  {
    key: "promo",
    label: "Promo",
    guide:
      "The deal on now: what it's good for and who it suits. The picture's promo layers show the offer and end date, read live.",
    example: "The spring deal - good for a laptop tune-up before the holidays.",
  },
  {
    key: "general",
    label: "General post",
    guide: "A short post about the business: what's happening and what it means for the reader.",
    example: "I'm away 20 to 27 October; book now for the week after.",
  },
];

/**
 * The dialog's starting kind for a design.
 * @param kind - The design's kind.
 * @returns A {@link POST_DRAFT_KINDS} key.
 */
export function draftKindFor(kind: DesignKind): string {
  return kind === "blank" ? "general" : kind;
}

/** Which words a design has somewhere to put. */
export interface DraftRoom {
  headline: boolean;
  support: boolean;
  /** Ticked points to write, 0 for none. */
  bullets: number;
  quote: boolean;
  name: boolean;
}

/** What the route returns: words for the picture's layers and the post. */
export interface DesignDraft {
  headline: string;
  support: string;
  bullets: string[];
  quote: string;
  name: string;
  /** Post words for Facebook and Instagram; Use in post puts them in an empty post. */
  caption: string;
}

/** Roles a draft writes into a text layer. */
const WORD_ROLES = ["headline", "support", "quote", "name"] as const;

/**
 * First text layer with a role.
 * @param doc - Design.
 * @param role - Role.
 * @returns The layer, or undefined.
 */
function textWithRole(doc: DesignDoc, role: LayerRole): Layer | undefined {
  return doc.layers.find((l) => l.type === "text" && l.role === role);
}

/**
 * What words a design has room for, read from its layers' roles. A design with no
 * word layers at all (a blank one) gets a headline and a short line, which the editor
 * adds; any other design gets only what it already has, so a template keeps its shape.
 * @param doc - Design.
 * @returns The room.
 */
export function draftRoom(doc: DesignDoc): DraftRoom {
  const bullets = doc.layers.find((l) => l.type === "bullets");
  /**
   * Whether the design has a text layer with a role.
   * @param role - Role.
   * @returns True when it does.
   */
  const has = (role: LayerRole): boolean => textWithRole(doc, role) !== undefined;
  const blank = !bullets && !WORD_ROLES.some(has);
  return {
    headline: blank || has("headline"),
    support: blank || has("support"),
    bullets:
      bullets?.type === "bullets"
        ? Math.min(Math.max(bullets.items.length, 3), MAX_DRAFT_BULLETS)
        : 0,
    quote: has("quote"),
    name: has("name"),
  };
}

/**
 * Reads a room sent by the editor, or null when it isn't one.
 * @param raw - Request field.
 * @returns The room.
 */
export function readRoom(raw: unknown): DraftRoom | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  /**
   * Whether a field is a true or false.
   * @param v - Field.
   * @returns True for a boolean.
   */
  const flag = (v: unknown): v is boolean => typeof v === "boolean";
  if (![r.headline, r.support, r.quote, r.name].every(flag)) return null;
  const bullets = r.bullets;
  if (typeof bullets !== "number" || !Number.isInteger(bullets)) return null;
  if (bullets < 0 || bullets > MAX_DRAFT_BULLETS) return null;
  return {
    headline: r.headline as boolean,
    support: r.support as boolean,
    bullets,
    quote: r.quote as boolean,
    name: r.name as boolean,
  };
}

/**
 * A trimmed string with plain punctuation, or "" when missing, cut to a length.
 * @param value - Raw value.
 * @param max - Longest allowed.
 * @returns The string.
 */
function text(value: unknown, max: number): string {
  return typeof value === "string" ? plainPunctuation(value.trim()).trim().slice(0, max) : "";
}

/**
 * Lower-case words of a text, for comparing a quote with the brief it came from.
 * @param value - Text.
 * @returns Words, apostrophes kept so "it's" stays one word.
 */
function wordsOf(value: string): string[] {
  return (
    plainPunctuation(value)
      .toLowerCase()
      .match(/[\p{L}\p{N}']+/gu) ?? []
  );
}

/**
 * Whether a quote or name is drawn from the brief. The prompt only lets the model cut a
 * customer's words, never add any; this backs that up, so a made-up review can't reach
 * the picture. A tenth of the words may differ, for the odd changed capital or "it is"
 * written as "it's".
 * @param value - The quote or name.
 * @param brief - The operator's brief.
 * @returns True when nearly every word is in the brief.
 */
export function fromBrief(value: string, brief: string): boolean {
  const words = wordsOf(value);
  if (words.length === 0) return true;
  const known = new Set(wordsOf(brief));
  const misses = words.filter((w) => !known.has(w)).length;
  return misses <= Math.floor(words.length / 10);
}

/**
 * Reads the model's JSON into a draft. Words the design has no room for are dropped, as
 * are a quote or name that isn't in the brief; lengths are capped so a runaway reply
 * can't flood the picture. Beyond straightening quotes and dashes the wording is left
 * as written: the operator reads every draft before it's posted.
 * @param raw - Parsed JSON from the model.
 * @param room - What the design has room for.
 * @param brief - The brief, for checking a quote and name.
 * @returns The draft, or null when it has nothing to fill in.
 */
export function readDesignDraft(raw: unknown, room: DraftRoom, brief: string): DesignDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const quote = room.quote ? text(r.quote, 300) : "";
  const name = room.name ? text(r.name, 80) : "";
  const bullets =
    room.bullets > 0 && Array.isArray(r.bullets)
      ? r.bullets
          .map((b) => text(b, 60))
          .filter(Boolean)
          .slice(0, MAX_DRAFT_BULLETS)
      : [];
  const draft: DesignDraft = {
    headline: room.headline ? text(r.headline, 80) : "",
    support: room.support ? text(r.support, 160) : "",
    bullets,
    quote: fromBrief(quote, brief) ? quote : "",
    name: fromBrief(name, brief) ? name : "",
    caption: text(r.caption, 1500),
  };
  const filled =
    draft.headline || draft.support || draft.quote || draft.bullets.length > 0 || draft.caption;
  return filled ? draft : null;
}

/** Word layers a draft needs added to a design that has none. */
export type MissingWords = ("headline" | "support")[];

/**
 * Fills a draft into a design: each part goes into the first layer with its role (the
 * ticked points into the first bullet list), and the post words into the caption. An
 * empty part leaves its layer as it was, so a review's "Paste the review here" stays
 * when the brief had no review words. Layout, styling and every other layer are left
 * alone.
 * @param doc - Design.
 * @param draft - The draft.
 * @returns The filled design, and the headline or short line that had no layer to go in.
 */
export function fillDraft(
  doc: DesignDoc,
  draft: DesignDraft,
): { doc: DesignDoc; missing: MissingWords } {
  const words: Partial<Record<LayerRole, string>> = {
    headline: draft.headline,
    support: draft.support,
    quote: draft.quote,
    name: draft.name,
  };
  const done = new Set<LayerRole>();
  let listDone = false;
  const layers = doc.layers.map((l): Layer => {
    if (l.type === "text" && l.role && !done.has(l.role) && words[l.role]) {
      done.add(l.role);
      return { ...l, text: words[l.role]! };
    }
    if (l.type === "bullets" && !listDone && draft.bullets.length > 0) {
      listDone = true;
      return { ...l, items: draft.bullets };
    }
    return l;
  });
  const missing: MissingWords = [];
  if (draft.headline && !textWithRole(doc, "headline")) missing.push("headline");
  if (draft.support && !textWithRole(doc, "support")) missing.push("support");
  return {
    doc: { ...doc, layers, caption: draft.caption || doc.caption },
    missing,
  };
}
