// src/features/contacts/lib/split-name.ts

/**
 * Splits a full display name into given (first) and family (last) parts. The
 * last whitespace-separated token becomes the family name and everything before
 * it the given name, so "Mary Jane Watson" > given "Mary Jane", family "Watson".
 * A single token has no family name; blank input yields two empty strings.
 * Returns empty strings (never null) so it can feed the Google People API
 * directly; callers that store nullable first/last names coerce "" to null.
 * @param fullName - Full display name (may be blank).
 * @returns Given and family name parts, each "" when absent.
 */
export function splitName(fullName: string): { givenName: string; familyName: string } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { givenName: "", familyName: "" };
  if (parts.length === 1) return { givenName: parts[0], familyName: "" };
  return { givenName: parts.slice(0, -1).join(" "), familyName: parts[parts.length - 1] };
}
