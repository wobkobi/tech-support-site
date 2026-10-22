// src/features/social/lib/tags.ts
// Post tags: the colour swatches, the key that makes "Tips" and "tips" one tag, and the shape
// the admin sees. Pure and client-safe.

/** Swatches a tag can take: the chip's classes and the dot the picker shows. */
export const TAG_COLOURS = {
  violet: {
    label: "Violet",
    chip: "border-russian-violet-200 bg-russian-violet-50 text-russian-violet-700",
    dot: "bg-russian-violet-400",
  },
  teal: {
    label: "Teal",
    chip: "border-rich-black-200 bg-rich-black-50 text-rich-black-800",
    dot: "bg-rich-black-700",
  },
  orange: {
    label: "Orange",
    chip: "border-coquelicot-200 bg-coquelicot-50 text-coquelicot-700",
    dot: "bg-coquelicot-500",
  },
  yellow: {
    label: "Yellow",
    chip: "border-mustard-300 bg-mustard-50 text-mustard-800",
    dot: "bg-mustard-500",
  },
  blue: {
    label: "Blue",
    chip: "border-moonstone-200 bg-moonstone-50 text-moonstone-800",
    dot: "bg-moonstone-600",
  },
  grey: {
    label: "Grey",
    chip: "border-seasalt-200 bg-seasalt-50 text-seasalt-700",
    dot: "bg-seasalt-500",
  },
} as const;

/** A tag swatch key. */
export type TagColour = keyof typeof TAG_COLOURS;

export const TAG_COLOUR_KEYS = Object.keys(TAG_COLOURS) as TagColour[];
export const MAX_TAG_NAME = 40;
/** Tags one post can carry. */
export const MAX_POST_TAGS = 20;

/** A tag as the admin sees it, with how many posts carry it. */
export interface SocialTagRow {
  id: string;
  name: string;
  colour: TagColour;
  count: number;
}

/**
 * Whether a value is a known swatch key.
 * @param value - Raw value.
 * @returns True for a {@link TagColour}.
 */
export function isTagColour(value: unknown): value is TagColour {
  return typeof value === "string" && Object.hasOwn(TAG_COLOURS, value);
}

/**
 * A tag name as typed, tidied: a leading # off and runs of spaces closed up.
 * @param name - Name as typed.
 * @returns The name to store.
 */
export function tagName(name: string): string {
  return name.normalize("NFC").replace(/\s+/g, " ").trim().replace(/^#+/, "").trimStart();
}

/**
 * The key two names share when they're the same tag: tidied and lowercased.
 * @param name - Name as typed.
 * @returns The key.
 */
export function tagKey(name: string): string {
  return tagName(name).toLocaleLowerCase("en-NZ");
}

/**
 * Orders tags A to Z, ignoring case and accents.
 * @param a - One tag.
 * @param b - Another.
 * @returns Negative when a comes first.
 */
export function byTagName(a: Pick<SocialTagRow, "name">, b: Pick<SocialTagRow, "name">): number {
  return a.name.localeCompare(b.name, "en-NZ", { sensitivity: "base" });
}

/**
 * The swatch for a new tag: the first one no tag uses yet, or the next round the list.
 * @param used - Colours the existing tags have.
 * @returns A swatch key.
 */
export function nextTagColour(used: readonly string[]): TagColour {
  return (
    TAG_COLOUR_KEYS.find((c) => !used.includes(c)) ??
    TAG_COLOUR_KEYS[used.length % TAG_COLOUR_KEYS.length]!
  );
}
