// src/shared/lib/normalize-phone.ts
/**
 * @file normalize-phone.ts
 * @description Shared phone number normalization and validation utilities.
 */

/**
 * Strips all non-digit characters except a leading '+'.
 * e.g. "021 123-456" → "021123456", "+64 21 123 456" → "+6421123456"
 * @param raw - Raw phone input string.
 * @returns Normalized phone string, or empty string if input is blank.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const prefix = trimmed.startsWith("+") ? "+" : "";
  const digits = trimmed.replace(/\D/g, "");
  return prefix + digits;
}

/**
 * Formats a phone number string for display with NZ-style spacing as the user types.
 * Preserves a leading '+' for international numbers.
 * Mobile (021/022/027/028/029): XXX XXX XXXX
 * Landline (09/04/03/06/07): XX XXX XXXX
 * @param raw - Raw phone input (may contain spaces, dashes, etc.).
 * @returns Display-formatted phone string.
 */
export function formatNZPhone(raw: string): string {
  const hasPlus = raw.trimStart().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return hasPlus ? "+" : "";

  if (hasPlus) {
    // +64 XX XXX XXXX (rough grouping for international)
    const a = digits.slice(0, 2);
    const b = digits.slice(2, 4);
    const c = digits.slice(4, 7);
    const d = digits.slice(7, 11);
    return ["+" + a, b, c, d].filter(Boolean).join(" ");
  }

  const mobilePrefixes = ["021", "022", "027", "028", "029"];
  if (mobilePrefixes.some((p) => digits.startsWith(p))) {
    // XXX XXX XXXX
    const a = digits.slice(0, 3);
    const b = digits.slice(3, 6);
    const c = digits.slice(6, 10);
    return [a, b, c].filter(Boolean).join(" ");
  }

  // Landline XX XXX XXXX
  const a = digits.slice(0, 2);
  const b = digits.slice(2, 5);
  const c = digits.slice(5, 9);
  return [a, b, c].filter(Boolean).join(" ");
}

/**
 * Converts a NZ phone number to E.164 format (+64...).
 * Handles all common NZ inputs:
 *   "021 123 1234"  → "+64211231234"
 *   "21 123 1234"   → "+64211231234"  (no leading 0)
 *   "09 123 4567"   → "+6491234567"   (landline)
 *   "+64 21 123 1234" → "+64211231234" (already E.164)
 *   "+61 400 000 000" → "+61400000000" (non-NZ: left as-is)
 * Non-NZ numbers (no leading 0, no NZ mobile prefix, no +) are returned normalized.
 * @param raw - Raw phone input string.
 * @returns E.164-normalized phone string, or empty string if input is blank.
 */
export function toE164NZ(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // Already has a + country code prefix - just strip formatting
  if (trimmed.startsWith("+")) return normalizePhone(trimmed);
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  // NZ domestic (leading 0): 021xxx, 09xxx, 04xxx etc.
  if (digits.startsWith("0")) return "+64" + digits.slice(1);
  // NZ mobile without leading 0: 21xxx, 22xxx, 27xxx, 28xxx, 29xxx
  const nzMobileShort = ["21", "22", "27", "28", "29"];
  if (nzMobileShort.some((p) => digits.startsWith(p)) && digits.length <= 9) {
    return "+64" + digits;
  }
  // Unknown / international without + - return digits as-is
  return digits;
}

/**
 * Returns true when a normalized phone string looks like a valid phone number.
 * Requires 7–15 digits (E.164 max). The leading '+' is ignored for the count.
 * @param normalized - Already-normalized phone string (from normalizePhone).
 * @returns Whether the phone number is valid.
 */
export function isValidPhone(normalized: string): boolean {
  if (!normalized) return true; // empty is fine - field is optional
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}
