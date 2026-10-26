// src/shared/lib/money.ts
// Shared money helpers: rounding a dollar figure to cents, and turning loosely-formatted
// money text (e.g. a price copied off a shop page) into a plain number for numeric inputs.

/**
 * Rounds dollars to cents to keep sums out of float drift (0.1 + 0.2 > 0.3), an exact half
 * cent going up as it would by hand: $4.02 x 25% = $1.005 > $1.01. Float noise is cleared
 * first, since 4.02 is stored as 4.0199999... and a bare Math.round(n * 100) lands that on
 * $1.00, and a sum's last-digit drift (533.3399999999999) can flip a cent by adding order.
 * @param n - Amount in dollars.
 * @returns The amount rounded to the nearest cent.
 */
export function roundCents(n: number): number {
  return toCents(n) / 100;
}

/**
 * Dollars as a whole number of cents, rounded as {@link roundCents} does.
 * @param n - Amount in dollars.
 * @returns Integer cents.
 */
export function toCents(n: number): number {
  return Math.round(Number((n * 100).toFixed(6)));
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
