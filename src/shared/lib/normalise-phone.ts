// src/shared/lib/normalise-phone.ts
// Shared phone number normalisation and validation utilities.

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
 * Formats a phone for display as typed, keeping a leading '+'. Mobile XXX XXX XXXX,
 * landline XX XXX XXXX.
 * @param raw - Raw phone input (may contain spaces, dashes, etc.).
 * @returns Display-formatted phone string.
 */
export function formatNZPhone(raw: string): string {
  const hasPlus = raw.trimStart().startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return hasPlus ? "+" : "";

  // Every branch's final group is open-ended (slice with no end) so a longer number keeps
  // all its digits. This formatter feeds the stored value on blur, so a dropped digit
  // corrupts the number - an 11-digit 021 mobile has an 8-digit subscriber part.
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

/** National part after +64: mobile 2 + 7-9 digits, landline 3/4/6/7/9 + 7, freephone 800 + 6-7 or 508 + 6. */
const NZ_NATIONAL_NUMBER = /^(?:2\d{7,9}|[34679]\d{7}|800\d{6,7}|508\d{6})$/;

/**
 * Converts an NZ phone to E.164: "021 123 1234", "21 123 1234", "64 21...", "0064 21..." and
 * "+64 (0)21..." all > "+64211231234"; non-NZ "+61..." stays as-is. Anything else returns bare
 * digits with no '+', which validatePhone rejects ("1234567" has no area code).
 * @param raw - Raw phone input string.
 * @returns E.164-normalised phone string, or empty string if input is blank.
 */
export function toE164NZ(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // Already has a + country code prefix - strip formatting, and drop the trunk 0 people
  // often keep after +64 ("+64 021 ..."), which no NZ number carries in E.164.
  if (trimmed.startsWith("+")) {
    const normalised = normalisePhone(trimmed);
    return normalised.startsWith("+640") ? "+64" + normalised.slice(4) : normalised;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  // 00 is the overseas dialling prefix, typed in place of + ("0064 21 ...").
  if (digits.startsWith("00")) return toE164NZ("+" + digits.slice(2));
  // NZ domestic (leading 0): 021xxx, 09xxx, 04xxx etc.
  if (digits.startsWith("0")) return "+64" + digits.slice(1);
  // The country code without its + ("64 21 ..."), taken only when what follows is a
  // real NZ number so a foreign number starting 64 isn't claimed.
  if (digits.startsWith("64") && NZ_NATIONAL_NUMBER.test(digits.slice(2))) return "+" + digits;
  // A real NZ number missing its leading 0 ("21 123 4567", "9 123 4567").
  if (NZ_NATIONAL_NUMBER.test(digits)) return "+64" + digits;
  // Unknown / international without + - return digits as-is
  return digits;
}

/**
 * Canonical phone matching key: E.164 then stripped, so "021 123 4567" and "+64211234567" match.
 * Every phone lookup must use this one normaliser so matchers can't drift.
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
 * Whether a phone key is an NZ mobile (02x). Only mobiles are personal enough to auto-merge on.
 * @param key - A normalised phone key from {@link normaliseContactPhone} (E.164 "+642x...", or a domestic "02x" form).
 * @returns Whether the number is an NZ mobile.
 */
export function isNZMobileKey(key: string | null | undefined): boolean {
  if (!key) return false;
  const digits = key.replace(/\D/g, "");
  return /^64(21|22|27|28|29)\d/.test(digits) || /^02(1|2|7|8|9)\d/.test(digits);
}

/** {@link validatePhone} result; "empty" is blank input, which callers allow or not. */
export type PhoneValidationResult = "empty" | "invalid" | "ok";

/**
 * Whether a {@link toE164NZ} value is diallable: needs a '+', NZ numbers need a real NZ shape,
 * others only the 7-15 digit check.
 * @param e164 - Output of {@link toE164NZ}.
 * @returns Whether the number is diallable.
 */
function isDiallable(e164: string): boolean {
  if (!e164.startsWith("+")) return false;
  if (e164.startsWith("+64")) return NZ_NATIONAL_NUMBER.test(e164.slice(3));
  return isValidPhone(e164);
}

/** Options for {@link validatePhone}. */
export interface ValidatePhoneOptions {
  /** Public forms: only NZ numbers are taken, so any other country code is invalid. */
  nzOnly?: boolean;
}

/**
 * The canonical phone validator, returning a verdict for caller wording plus the E.164 form.
 * @param raw - Raw phone input.
 * @param opts - Validation options.
 * @param opts.nzOnly - Reject numbers from any country but NZ.
 * @returns Validation result and the E.164-normalised value (empty when not "ok").
 */
export function validatePhone(
  raw: string,
  opts: ValidatePhoneOptions = {},
): { result: PhoneValidationResult; e164: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { result: "empty", e164: "" };
  const e164 = toE164NZ(trimmed);
  if (!isDiallable(e164)) return { result: "invalid", e164: "" };
  if (opts.nzOnly && !e164.startsWith("+64")) return { result: "invalid", e164: "" };
  return { result: "ok", e164 };
}
