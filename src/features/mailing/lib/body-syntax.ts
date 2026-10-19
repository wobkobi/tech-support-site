// src/features/mailing/lib/body-syntax.ts
// Line patterns of a mailing email body, shared by the renderer, the block editor's parser
// and "Share to social" so they agree on what a line means.

/** A line that is only `[Text](https://...)`: rendered as a button. */
export const BUTTON_LINE_RE = /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)$/i;

/**
 * A line that is only `![alt](https://...)`: a picture; `![alt](url "small")` is half width.
 * Groups: 1 alt, 2 image URL, 3 `small` when present.
 */
export const IMAGE_LINE_RE = /^!\[([^\]\n]*)\]\((https:\/\/[^)\s]+)(?:\s+"(small)")?\)$/i;

/**
 * A button still waiting for its link, `[Text]()`; left out and listed as a problem until
 * it has one. Group 1 is the button text.
 */
export const BUTTON_PLACEHOLDER_RE = /^\[([^\]\n]+)\]\(\)$/;

/**
 * A picture still to be chosen, `![alt]()`; left out and listed as a problem until it has
 * one. Group 1 is the alt text.
 */
export const PICTURE_PLACEHOLDER_RE = /^!\[([^\]\n]*)\]\(\)$/;

/**
 * A picture wrapped in a link, `[![alt](img)](https://link)`: a clickable picture.
 * Groups: 1 alt, 2 image URL, 3 `small` when present, 4 link URL.
 */
export const LINKED_IMAGE_LINE_RE =
  /^\[!\[([^\]\n]*)\]\((https:\/\/[^)\s]+)(?:\s+"(small)")?\)\]\((https?:\/\/[^)\s]+)\)$/i;

/** An inline `[text](https://...)` link inside paragraph text. */
export const INLINE_LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gi;

/** A `::word` line: a block with no text of its own, like the promo card. */
export const DIRECTIVE_RE = /^::(\w+)$/;

/** Directives the renderer draws. Anything else is dropped and listed as a problem. */
export const DIRECTIVES = ["promo", "space", "social"] as const;

/** One of {@link DIRECTIVES}. */
export type Directive = (typeof DIRECTIVES)[number];

/**
 * Whether a `::word` names a directive the renderer knows.
 * @param word - The word after `::`.
 * @returns True for a known directive.
 */
export function isDirective(word: string): word is Directive {
  return (DIRECTIVES as readonly string[]).includes(word);
}

/** A line of three or more dashes: a divider. */
export const DIVIDER_RE = /^-{3,}$/;

/** A `> ` line: part of a review quote. Group 1 is the text after the marker. */
export const QUOTE_LINE_RE = /^>[ \t]?(.*)$/;

/** A quote line that is only stars, `★★★★★`. Group 1 is the stars. */
export const QUOTE_STARS_RE = /^(★{1,5})$/;

/** A quote line naming who said it, `- Name, Suburb`. Group 1 is the name. */
export const QUOTE_NAME_RE = /^-\s+(.+)$/;

/**
 * Whether a trimmed line is a bullet list item, `- item` or `* item`.
 * @param line - A trimmed body line.
 * @returns True for a list item.
 */
export function isListLine(line: string): boolean {
  return line.startsWith("- ") || line.startsWith("* ");
}

/**
 * A `>> ` line: part of a big box (coloured panel, large headline). Check it before
 * {@link QUOTE_LINE_RE}, which also matches. Group 1 is the text after the marker.
 */
export const BOX_LINE_RE = /^>>[ \t]?(.*)$/;

/** A big box's parts, read from its `>> ` lines. */
export interface BoxParts {
  /** Background photo URL, or "" for the plain brand colour. */
  photo: string;
  /** The large line; a box without one is left out. */
  headline: string;
  /** Smaller lines under the headline. */
  lines: string[];
  /** Button words, or "" for no button. */
  label: string;
  /** Button link, or "" while it waits for one. */
  url: string;
}

/**
 * Reads a big box from its `>> ` lines (markers stripped): first picture is the photo,
 * first button the button, first other line the headline, the rest smaller lines.
 * @param lines - Trimmed line texts, blank ones already dropped.
 * @returns The box's parts.
 */
export function readBox(lines: readonly string[]): BoxParts {
  const box: BoxParts = { photo: "", headline: "", lines: [], label: "", url: "" };
  let hasPhoto = false;
  let hasButton = false;
  for (const line of lines) {
    const photo = line.match(IMAGE_LINE_RE) ?? line.match(PICTURE_PLACEHOLDER_RE);
    if (photo && !hasPhoto) {
      hasPhoto = true;
      box.photo = photo[2] ?? "";
      continue;
    }
    const button = line.match(BUTTON_LINE_RE) ?? line.match(BUTTON_PLACEHOLDER_RE);
    if (button && !hasButton) {
      hasButton = true;
      box.label = button[1]!;
      box.url = button[2] ?? "";
      continue;
    }
    if (!box.headline) box.headline = line;
    else box.lines.push(line);
  }
  return box;
}
