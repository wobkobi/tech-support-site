// src/shared/lib/parse-money.ts
/**
 * @file parse-money.ts
 * @description Shared helpers for turning loosely-formatted money text (e.g. a
 * price copied off a shop page) into a plain number for numeric inputs.
 */

/**
 * Strip currency symbols, thousands separators, and surrounding whitespace from
 * a money string and parse the remainder.
 * e.g. "$1,089.00" > 1089, " 89.50 " > 89.5
 * @param raw - Raw pasted or typed text.
 * @returns The numeric value, or null when there is nothing numeric to extract.
 */
export function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}
