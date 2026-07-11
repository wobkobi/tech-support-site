// src/shared/lib/normalise-phone.ts
/**
 * @description Shared phone number normalisation and validation utilities.
 */

/**
 * Strip all non-digit characters except a leading '+'.
 * e.g. "021 123-456" > "021123456", "+64 21 123 456" > "+6421123456"
 * @param raw - Raw phone input string.
 * @returns Normalised phone string, or empty string if input is blank.
 */
export function normalisePhone(raw: string): string {
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

  // Every branch's final group is open-ended (slice with no end) so a longer
  // number keeps all its digits - this is a display formatter that feeds the
  // stored value on blur, so dropping a digit would corrupt the phone number
  // (e.g. an 11-digit 021 mobile with an 8-digit subscriber part).
  if (hasPlus) {
    // +64 XX XXX XXXX... (rough grouping for international)
    const a = digits.slice(0, 2);
    const b = digits.slice(2, 4);
    const c = digits.slice(4, 7);
    const d = digits.slice(7);
    return ["+" + a, b, c, d].filter(Boolean).join(" ");
  }

  const mobilePrefixes = ["021", "022", "027", "028", "029"];
  if (mobilePrefixes.some((p) => digits.startsWith(p))) {
    // XXX XXX XXXX...
    const a = digits.slice(0, 3);
    const b = digits.slice(3, 6);
    const c = digits.slice(6);
    return [a, b, c].filter(Boolean).join(" ");
  }

  // Landline XX XXX XXXX...
  const a = digits.slice(0, 2);
  const b = digits.slice(2, 5);
  const c = digits.slice(5);
  return [a, b, c].filter(Boolean).join(" ");
}

/**
 * Converts a NZ phone number to E.164 format (+64...).
 * Handles all common NZ inputs:
 *   "021 123 1234"  > "+64211231234"
 *   "21 123 1234"   > "+64211231234"  (no leading 0)
 *   "09 123 4567"   > "+6491234567"   (landline)
 *   "+64 21 123 1234" > "+64211231234" (already E.164)
 *   "+61 400 000 000" > "+61400000000" (non-NZ: left as-is)
 * Non-NZ numbers (no leading 0, no NZ mobile prefix, no +) are returned normalised.
 * @param raw - Raw phone input string.
 * @returns E.164-normalised phone string, or empty string if input is blank.
 */
export function toE164NZ(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // Already has a + country code prefix - just strip formatting
  if (trimmed.startsWith("+")) return normalisePhone(trimmed);
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
 * Canonical matching key for a contact/booking phone. Runs the raw value through
 * E.164 conversion first (so "021 123 4567" and "+64211234567" collapse to the
 * same key) then strips formatting. Returns null for blank/unparseable input so
 * callers can skip it. This is the ONE normaliser every phone-based lookup must
 * use - reimplementing the `toE164NZ` + `normalisePhone` combo inline is what let
 * the site and Google matchers drift apart.
 * @param raw - Raw phone input (may be null/undefined).
 * @returns Normalised E.164 digit key, or null when there is nothing to match on.
 */
export function normaliseContactPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = normalisePhone(toE164NZ(raw) || raw);
  return key || null;
}

/**
 * Returns true when a normalised phone string looks like a valid phone number.
 * Requires 7-15 digits (E.164 max). The leading '+' is ignored for the count.
 * @param normalised - Already-normalised phone string (from {@link normalisePhone}).
 * @returns Whether the phone number is valid.
 */
export function isValidPhone(normalised: string): boolean {
  if (!normalised) return true; // empty is fine - field is optional
  const digits = normalised.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * True when a normalised phone key is an NZ mobile (02x prefix). Mobiles are
 * personal; landlines are often shared across a household, so only mobiles are
 * safe to treat as a person-identity key when auto-merging contacts.
 * @param key - A normalised phone key from {@link normaliseContactPhone} (E.164 "+642x...", or a domestic "02x" form).
 * @returns Whether the number is an NZ mobile.
 */
export function isNZMobileKey(key: string | null | undefined): boolean {
  if (!key) return false;
  const digits = key.replace(/\D/g, "");
  return /^64(21|22|27|28|29)\d/.test(digits) || /^02(1|2|7|8|9)\d/.test(digits);
}

/**
 * Discriminator returned by {@link validatePhone}. "empty" means the input is blank
 * (callers decide whether that's allowed based on whether the field is required).
 */
export type PhoneValidationResult = "empty" | "invalid" | "ok";

/**
 * Single canonical phone validator used by the shared PhoneInput component and
 * by every submit handler that accepts a phone number. Returns a discriminator
 * so callers can pick their own wording, plus the E.164 form for storage.
 * @param raw - Raw phone input.
 * @returns Validation result and the E.164-normalised value (empty when not "ok").
 */
export function validatePhone(raw: string): { result: PhoneValidationResult; e164: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { result: "empty", e164: "" };
  const e164 = toE164NZ(trimmed);
  // Non-empty input that normalises to no usable digits (letters/symbols) is
  // invalid - isValidPhone treats empty as acceptable for optional fields, so
  // guard the zero-digit case here rather than loosening isValidPhone.
  if (!e164.replace(/\D/g, "") || !isValidPhone(e164)) {
    return { result: "invalid", e164: "" };
  }
  return { result: "ok", e164 };
}
