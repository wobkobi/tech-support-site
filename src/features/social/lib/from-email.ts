// src/features/social/lib/from-email.ts
// Turns a mailing-list email body into a social post start: formatting stripped (apps show
// markdown as typed), first button as link, first picture as image.

import {
  BOX_LINE_RE,
  BUTTON_LINE_RE,
  BUTTON_PLACEHOLDER_RE,
  DIRECTIVE_RE,
  DIVIDER_RE,
  IMAGE_LINE_RE,
  INLINE_LINK_RE,
  LINKED_IMAGE_LINE_RE,
  PICTURE_PLACEHOLDER_RE,
  QUOTE_LINE_RE,
} from "@/features/mailing/lib/body-syntax";

// "Hi {firstName}," and friends: an email greeting reads oddly at the top of a post.
const GREETING_RE = /^(hi|hello|hey|kia ora|dear)\s+\{(firstName|name)\},?$/i;
// One person's own review: meaningless, and private, in a public post.
const REVIEW_TEXT_RE = /\{reviewText\}/;

/** What an email body becomes as a post. */
export interface PostFromEmail {
  body: string;
  linkUrl: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
}

/**
 * Converts an email body to post text, link and picture. The promo card becomes `{promo}`;
 * spacers, dividers and social links drop; review quotes and big boxes lose their `> `/`>> `
 * markers (a recipient's own review and a big box's darkened photo are skipped).
 * @param emailBody - The email's body text.
 * @returns Plain-text body, the first button's URL and the first picture.
 */
export function postFromEmail(emailBody: string): PostFromEmail {
  let linkUrl: string | null = null;
  let imageUrl: string | null = null;
  let imageAlt: string | null = null;
  const lines: string[] = [];
  let quote: string[] = [];

  /** Adds the quote being collected, unless it quotes the recipient's own review. */
  function flushQuote(): void {
    if (!quote.some((l) => REVIEW_TEXT_RE.test(l))) lines.push(...quote.filter(Boolean));
    quote = [];
  }

  for (const raw of emailBody.replace(/\r\n/g, "\n").split("\n")) {
    let line = raw.trim();
    const boxed = line.match(BOX_LINE_RE);
    if (boxed) {
      line = boxed[1]!.trim();
      if (IMAGE_LINE_RE.test(line) || PICTURE_PLACEHOLDER_RE.test(line)) continue;
    }
    const quoted = boxed ? null : line.match(QUOTE_LINE_RE);
    if (quoted) {
      quote.push(quoted[1]!.trim());
      continue;
    }
    flushQuote();
    if (PICTURE_PLACEHOLDER_RE.test(line) || BUTTON_PLACEHOLDER_RE.test(line)) continue;
    const image = line.match(LINKED_IMAGE_LINE_RE) ?? line.match(IMAGE_LINE_RE);
    if (image) {
      if (!imageUrl) {
        imageUrl = image[2]!;
        imageAlt = image[1]!.trim() || null;
      }
      continue;
    }
    const button = line.match(BUTTON_LINE_RE);
    if (button) {
      linkUrl ??= button[2]!;
      continue;
    }
    const directive = line.match(DIRECTIVE_RE);
    if (directive) {
      if (directive[1] === "promo") lines.push("{promo}");
      continue;
    }
    if (DIVIDER_RE.test(line)) line = "";
    if (lines.length === 0 && (line === "" || GREETING_RE.test(line))) continue;
    if (REVIEW_TEXT_RE.test(line)) continue;
    lines.push(
      line
        .replace(/^#{1,3}\s+/, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(INLINE_LINK_RE, "$1 ($2)"),
    );
  }
  flushQuote();

  const body = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { body, linkUrl, imageUrl, imageAlt };
}
