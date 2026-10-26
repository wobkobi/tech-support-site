// src/shared/lib/json-ld.ts
// Serialises structured data for an inline `<script type="application/ld+json">` block.

/** JSON's own escape for "<", which every JSON reader turns back into the character. */
const LT_ESCAPE = `${String.fromCharCode(92)}u003c`;

/**
 * JSON for an inline ld+json script. Every "<" is escaped, so a value holding "</script>"
 * can't end the tag early and run as markup.
 * @param data - The structured data.
 * @returns The script's inner HTML.
 */
export function jsonLdHtml(data: unknown): string {
  return JSON.stringify(data).replace(/</g, LT_ESCAPE);
}
