// src/features/reviews/lib/validation.ts
/**
 * @description Shared review-text length validation (10-1000 characters) used
 * by both the public submission form and the server route.
 */

/**
 * Validates review text length constraints.
 * @param text - The trimmed review text to validate.
 * @returns An error message string if invalid, or null if valid.
 */
export function reviewTextError(text: string | undefined): string | null {
  const t = text?.trim() ?? "";
  if (t.length < 10) return "Review must be at least 10 characters.";
  if (t.length > 1000) return "Review must be 1000 characters or less.";
  return null;
}
