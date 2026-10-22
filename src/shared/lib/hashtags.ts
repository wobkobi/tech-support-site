// src/shared/lib/hashtags.ts
// Reads a typed list of hashtags ("#tech, auckland #NZ") into clean tags, for the brand
// profile's validator and the AI writers that add them.

/** Most brand hashtags the profile keeps. */
export const MAX_BRAND_HASHTAGS = 10;

// The characters Instagram and Facebook keep in a tag; anything else ends it early.
const TAG_RE = /^[\p{L}\p{N}_]+$/u;

/** Tags read from a typed list, plus any words that can't be a hashtag. */
export interface ParsedHashtags {
  /** Tags without the leading `#`, deduped case-insensitively, first spelling kept. */
  tags: string[];
  /** Words as typed that hold other characters (a dash, a full stop). */
  bad: string[];
}

/**
 * Splits on spaces and commas, drops leading `#`s and repeats.
 * @param raw - The list as typed.
 * @returns The tags and any words that aren't valid tags.
 */
export function parseHashtags(raw: string): ParsedHashtags {
  const tags: string[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const word of raw.split(/[\s,]+/)) {
    const tag = word.replace(/^#+/, "");
    if (!tag) continue;
    if (!TAG_RE.test(tag)) {
      bad.push(word);
      continue;
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return { tags, bad };
}

/**
 * Writes tags back out the way a caption shows them.
 * @param tags - Tags without the `#`.
 * @returns Space-separated tags, like "#tech #auckland".
 */
export function formatHashtags(tags: string[]): string {
  return tags.map((t) => `#${t}`).join(" ");
}
