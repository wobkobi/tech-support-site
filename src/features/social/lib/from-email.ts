// src/features/social/lib/from-email.ts
// Turns a mailing-list email body (the editor's markdown-lite) into a starting point for
// a social post. Facebook and Instagram show markdown as typed, so formatting is stripped,
// the first button becomes the post's link, and the first picture becomes its image.
// The line patterns match src/features/mailing/lib/render.ts.

const BUTTON_LINE_RE = /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)$/i;
const IMAGE_LINE_RE = /^!\[([^\]\n]*)\]\((https:\/\/[^)\s]+)\)$/i;
const INLINE_LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gi;
// "Hi {firstName}," and friends: an email greeting reads oddly at the top of a post.
const GREETING_RE = /^(hi|hello|hey|kia ora|dear)\s+\{(firstName|name)\},?$/i;

/** What an email body becomes as a post. */
export interface PostFromEmail {
  body: string;
  linkUrl: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
}

/**
 * Converts an email body to post text plus a link and picture.
 * @param emailBody - The email's body text.
 * @returns Plain-text body, the first button's URL and the first picture.
 */
export function postFromEmail(emailBody: string): PostFromEmail {
  let linkUrl: string | null = null;
  let imageUrl: string | null = null;
  let imageAlt: string | null = null;
  const lines: string[] = [];

  for (const raw of emailBody.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const image = line.match(IMAGE_LINE_RE);
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
    if (lines.length === 0 && (line === "" || GREETING_RE.test(line))) continue;
    lines.push(
      line
        .replace(/^#{1,3}\s+/, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(INLINE_LINK_RE, "$1 ($2)"),
    );
  }

  const body = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { body, linkUrl, imageUrl, imageAlt };
}
