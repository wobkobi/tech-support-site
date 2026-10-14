// src/features/mailing/lib/body-syntax.ts
// The line patterns of a mailing email body. The renderer, the block editor's parser and
// "Share to social" all read the body with these, so the three can't disagree about what
// a line means.

/** A line that is only `[Text](https://...)`: rendered as a button. */
export const BUTTON_LINE_RE = /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)$/i;

/**
 * A line that is only `![alt](https://...)`: rendered as a picture. An optional
 * `"small"` title (`![alt](url "small")`) makes it half width and centred.
 * Groups: 1 alt, 2 image URL, 3 `small` when present.
 */
export const IMAGE_LINE_RE = /^!\[([^\]\n]*)\]\((https:\/\/[^)\s]+)(?:\s+"(small)")?\)$/i;

/**
 * A picture still to be chosen, `![alt]()`: a template's header picture before
 * one is uploaded. Left out of the email (and listed as a problem) until it has one.
 * Group 1 is the alt text.
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
