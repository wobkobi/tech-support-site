// src/features/reviews/lib/formatting.ts
/**
 * @file formatting.ts
 * @description Shared formatting utilities for review display.
 */

/**
 * Converts a string to title case, keeping small words lowercase unless they're first.
 * @param str - String to convert.
 * @returns Title-cased string.
 */
export function toTitleCase(str: string): string {
  const smallWords = new Set([
    "of",
    "the",
    "and",
    "or",
    "in",
    "on",
    "at",
    "to",
    "for",
    "from",
    "a",
    "an",
  ]);
  return str
    .toLowerCase()
    .split(" ")
    .map((word, index) => {
      // Always capitalize first word, or if not a small word
      if (index === 0 || !smallWords.has(word)) {
        return word[0].toUpperCase() + word.slice(1);
      }
      return word;
    })
    .join(" ");
}

/**
 * Formats a reviewer's display name with proper title casing.
 * Returns "Anonymous" if the review is marked anonymous or has no name.
 * @param r - Review fields.
 * @param r.firstName - First name or null.
 * @param r.lastName - Last name or null.
 * @param r.isAnonymous - Whether the review is posted anonymously.
 * @returns Formatted name string.
 */
export function formatReviewerName(r: {
  firstName?: string | null;
  lastName?: string | null;
  isAnonymous?: boolean | null;
}): string {
  if (r.isAnonymous) return "Anonymous";
  const f = (r.firstName ?? "").trim();
  const l = (r.lastName ?? "").trim();
  if (!f && !l) return "Anonymous";

  // Combine and title case the full name
  const fullName = [f, l].filter(Boolean).join(" ");
  return fullName ? toTitleCase(fullName) : "Anonymous";
}
