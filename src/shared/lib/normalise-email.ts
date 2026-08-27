// src/shared/lib/normalise-email.ts
// Single source of truth for the email form that gets stored, matched and sent to. Every
// provider the site deals with treats addresses case-insensitively, so storing
// "Jane.Smith@Example.com" beside "jane.smith@example.com" only ever produces duplicate
// contacts and missed review-cooldown matches.

/**
 * Normalises an email address for storage and comparison: trims surrounding
 * whitespace and lowercases the whole address. Blank and malformed input pass
 * straight through - validation is a separate concern, and this must never
 * turn an invalid address into a different invalid address.
 * @param raw - Raw email input, possibly null or undefined.
 * @returns Trimmed, lowercased address; empty string when there is nothing to normalise.
 */
export function normaliseEmail(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Normalises an optional email for a nullable column: an address that
 * normalises to empty becomes null rather than an empty string, so "no email"
 * is stored one way only.
 * @param raw - Raw email input, possibly null or undefined.
 * @returns Normalised address, or null when blank.
 */
export function normaliseEmailOrNull(raw: string | null | undefined): string | null {
  return normaliseEmail(raw) || null;
}
