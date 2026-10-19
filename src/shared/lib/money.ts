// src/shared/lib/money.ts
// Shared money helpers: rounding a dollar figure to cents, and turning loosely-formatted
// money text (e.g. a price copied off a shop page) into a plain number for numeric inputs.

/**
 * Rounds dollars to cents to keep sums out of float drift (0.1 + 0.2 > 0.3).
 * @param n - Amount in dollars.
 * @returns The amount rounded to the nearest cent.
 */
export function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Parses a pasted money string, refusing to guess on ambiguity. "$1,089.00" > 1089; null for
 * negatives, accounting parentheses, multiple decimal points or no digits.
 * @param raw - Raw pasted or typed text.
 * @returns The numeric value, or null when empty, negative or ambiguous.
 */
export function parseMoney(raw: string): number | null {
  const trimmed = raw.trim();
  // Reject negative markers before stripping symbols - a leading "-", one tucked after the
  // currency symbol ("$-20"), or accounting parentheses ("(20.00)") - so a refund pasted
  // from a statement is refused rather than landing as a positive cost.
  if (trimmed === "" || /[-()]/.test(trimmed)) return null;
  const cleaned = trimmed.replace(/[^\d.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  if ((cleaned.match(/\./g) ?? []).length > 1) return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}
