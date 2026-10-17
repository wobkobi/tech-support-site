// src/shared/lib/money.ts
// Shared money helpers: rounding a dollar figure to cents, and turning loosely-formatted
// money text (e.g. a price copied off a shop page) into a plain number for numeric inputs.

/**
 * Rounds a dollar figure to cents, keeping summed and multiplied amounts out of
 * float drift (0.1 + 0.2 > 0.3, not 0.30000000000000004).
 * @param n - Amount in dollars.
 * @returns The amount rounded to the nearest cent.
 */
export function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Strip currency symbols, thousands separators, and surrounding whitespace from
 * a money string and parse the remainder. Refuses to guess when the input is
 * ambiguous so a malformed paste falls back to the native number input rather
 * than silently landing a wrong figure in the cost field.
 *
 * Accepts: "$1,089.00" > 1089, " 89.50 " > 89.5, "0" > 0.
 * Rejects (returns null): negatives anywhere ("-$5", "$-20"), accounting-style
 * parentheses ("(20.00)"), multiple decimal points ("$1.234.56" or "1.2.3"),
 * and strings with no digits at all.
 * @param raw - Raw pasted or typed text.
 * @returns The numeric value, or null when the input is empty, negative, or has
 * an ambiguous decimal structure.
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
