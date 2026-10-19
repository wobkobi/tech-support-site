// src/features/contacts/lib/split-name.ts

/**
 * Splits a display name on its last token: "Mary Jane Watson" > "Mary Jane" + "Watson".
 * Returns "" (never null) so it can feed the Google People API directly.
 * @param fullName - Full display name (may be blank).
 * @returns Given and family name parts, each "" when absent.
 */
export function splitName(fullName: string): { givenName: string; familyName: string } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { givenName: "", familyName: "" };
  if (parts.length === 1) return { givenName: parts[0]!, familyName: "" };
  return { givenName: parts.slice(0, -1).join(" "), familyName: parts[parts.length - 1]! };
}
