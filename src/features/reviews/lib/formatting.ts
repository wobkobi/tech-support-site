// src/features/reviews/lib/formatting.ts
/**
 * @file formatting.ts
 * @description Shared formatting utilities for review display.
 */

/**
 * Formats a reviewer's display name exactly as stored.
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
  if (f && l) return `${f} ${l}`;
  return f || l;
}
