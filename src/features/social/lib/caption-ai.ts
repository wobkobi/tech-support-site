// src/features/social/lib/caption-ai.ts
// Write with AI for a post's words: the dialog's choices, the request it sends and reading the
// reply. Pure and client-safe; the prompt is in caption-ai.server.ts.

import { plainPunctuation } from "@/features/mailing/lib/ai-draft";
import { POST_DRAFT_KINDS } from "@/features/social-design/lib/ai-draft";
import {
  INSTAGRAM_MAX_CHARS,
  SOCIAL_PLATFORMS,
  type SocialPlatformKey,
} from "@/features/social/lib/validate";
import type { HashtagsDefault } from "@/shared/lib/settings/types";

/** The longest brief the dialog accepts. */
export const CAPTION_BRIEF_MAX = 1000;
/** Most options one click asks for. */
export const MAX_CAPTION_OPTIONS = 3;

/** How long new words should be. */
export const CAPTION_LENGTHS = [
  { key: "short", label: "Short (a sentence or two)" },
  { key: "medium", label: "Medium (a short paragraph or two)" },
  { key: "long", label: "Long (two or three paragraphs)" },
] as const;
export type CaptionLength = (typeof CAPTION_LENGTHS)[number]["key"];

/** Changes the dialog can make to words already written. */
export const CAPTION_ACTIONS = [
  { key: "shorter", label: "Make it shorter" },
  { key: "friendlier", label: "Make it friendlier" },
  { key: "plainer", label: "Use plainer words" },
  { key: "fix", label: "Fix spelling and grammar" },
  { key: "cta", label: "Add an ending" },
  { key: "hashtags", label: "Add hashtags" },
] as const;
export type CaptionAction = (typeof CAPTION_ACTIONS)[number]["key"];

/** What the last sentence asks the reader to do. */
export const CAPTION_ENDINGS = [
  { key: "none", label: "No set ending" },
  { key: "book", label: "Book online" },
  { key: "call", label: "Give me a call" },
  { key: "visit", label: "Visit my website" },
] as const;
export type CaptionEnding = (typeof CAPTION_ENDINGS)[number]["key"];

/** Kinds of post, shared with the post maker's Draft with AI. */
export const CAPTION_KINDS = POST_DRAFT_KINDS;

/** Everything the caption route needs. */
export interface CaptionRequest {
  /** "write" makes new words from the brief; "rewrite" changes the words in `brief`. */
  mode: "write" | "rewrite";
  /** What the post is about, or the post's current words when rewriting. */
  brief: string;
  /** The change to make when rewriting; null when writing. */
  action: CaptionAction | null;
  /** A {@link CAPTION_KINDS} key. */
  kind: string;
  length: CaptionLength;
  hashtags: boolean;
  emoji: boolean;
  ending: CaptionEnding;
  /** Apps these words go to; empty when no app is picked yet. */
  platforms: SocialPlatformKey[];
  /** Options to write, 1 to {@link MAX_CAPTION_OPTIONS}. */
  count: number;
  /** The post's linked promo, or null for whichever is running. */
  promoId: string | null;
}

/**
 * Picks a key from a list, or the fallback when the value isn't one of them.
 * @param list - Allowed entries.
 * @param value - Raw value.
 * @param fallback - Used when `value` isn't a key.
 * @returns The key.
 */
function pick<K extends string>(list: readonly { key: K }[], value: unknown, fallback: K): K {
  return list.find((e) => e.key === value)?.key ?? fallback;
}

/**
 * Reads the route's body into a request. Words only for Google never get hashtags, and fixing
 * spelling only ever needs one version.
 * @param body - Parsed JSON body.
 * @returns The request, or an error to show.
 */
export function parseCaptionRequest(body: unknown): CaptionRequest | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid request body" };
  const b = body as Record<string, unknown>;
  const mode = b.mode === "rewrite" ? "rewrite" : "write";
  const brief = typeof b.brief === "string" ? b.brief.trim() : "";
  if (!brief) {
    return { error: mode === "rewrite" ? "Write the post first." : "Say what the post is about." };
  }
  const max = mode === "rewrite" ? INSTAGRAM_MAX_CHARS : CAPTION_BRIEF_MAX;
  if (brief.length > max) return { error: `Keep it to ${max} characters or fewer.` };
  const action = mode === "rewrite" ? pick(CAPTION_ACTIONS, b.action, "fix") : null;
  const platforms = Array.isArray(b.platforms)
    ? SOCIAL_PLATFORMS.filter((p) => (b.platforms as unknown[]).includes(p))
    : [];
  const googleOnly = platforms.length === 1 && platforms[0] === "google";
  const count =
    action === "fix"
      ? 1
      : typeof b.count === "number" && Number.isInteger(b.count)
        ? Math.min(MAX_CAPTION_OPTIONS, Math.max(1, b.count))
        : 1;
  return {
    mode,
    brief,
    action,
    kind: pick(CAPTION_KINDS, b.kind, "general"),
    length: pick(CAPTION_LENGTHS, b.length, "medium"),
    hashtags: !googleOnly && (b.hashtags === true || action === "hashtags"),
    emoji: b.emoji === true,
    // Adding an ending with none picked adds the booking link, the usual next step.
    ending:
      action === "cta" && b.ending === "none" ? "book" : pick(CAPTION_ENDINGS, b.ending, "none"),
    platforms,
    count,
    promoId: typeof b.promoId === "string" && /^[a-f0-9]{24}$/i.test(b.promoId) ? b.promoId : null,
  };
}

/**
 * Whether the Hashtags tickbox starts ticked, from the brand profile's default.
 * @param setting - The profile's hashtag default.
 * @param platforms - Apps the words go to.
 * @returns True to start ticked.
 */
export function hashtagsOnByDefault(
  setting: HashtagsDefault,
  platforms: readonly SocialPlatformKey[],
): boolean {
  if (platforms.length === 1 && platforms[0] === "google") return false;
  if (setting === "always") return true;
  return setting === "instagram" && platforms.includes("instagram");
}

/**
 * The model's options, cleaned: plain punctuation, at most one blank line in a row, repeats
 * dropped, each capped at Instagram's limit.
 * @param raw - Parsed model reply.
 * @param count - Most options to keep.
 * @returns The options; empty when none came back.
 */
export function readCaptions(raw: unknown, count: number): string[] {
  const list = (raw as { captions?: unknown } | null)?.captions;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const text = plainPunctuation(item)
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, INSTAGRAM_MAX_CHARS)
      .trim();
    const key = text.toLowerCase().replace(/\s+/g, " ");
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === count) break;
  }
  return out;
}
