// src/shared/lib/normalise-email.ts
// The one stored email form. Providers treat addresses case-insensitively, so mixed case only
// causes duplicates and missed matches.

/**
 * Trims and lowercases an email. Blank and malformed input pass through; validation is separate.
 * @param raw - Raw email input, possibly null or undefined.
 * @returns Trimmed, lowercased address; empty string when there is nothing to normalise.
 */
export function normaliseEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Normalises an optional email for a nullable column; blank becomes null.
 * @param raw - Raw email input, possibly null or undefined.
 * @returns Normalised address, or null when blank.
 */
export function normaliseEmailOrNull(raw: string | null | undefined): string | null {
  return normaliseEmail(raw) || null;
}
