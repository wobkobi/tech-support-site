// src/shared/lib/normalise-name.ts
// Conservative cleanup and plausibility check for customer names; never rejects a possible name
// or re-cases intentional mixed case.

/**
 * Re-cases a token only when all lower or all upper, per hyphen/apostrophe part ("mary-jane" >
 * "Mary-Jane"); mixed case like "McDonald" is untouched.
 * @param token - A single whitespace-delimited name token.
 * @returns The re-cased token.
 */
function recaseToken(token: string): string {
  if (!token) return token;
  const isOneCase = token === token.toLowerCase() || token === token.toUpperCase();
  if (!isOneCase) return token;
  return token.replace(/[^\s-']+/g, (part) =>
    part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part,
  );
}

/**
 * Collapses whitespace and re-cases single-case tokens ("SMITH" > "Smith"), leaving mixed case.
 * @param raw - Raw name input.
 * @returns Tidied name, or empty string when the input is blank.
 */
export function normaliseName(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  return collapsed.split(" ").map(recaseToken).join(" ");
}

/**
 * Lenient name check: 2+ characters, a letter, not digits only. "asdf" passes, as no rule
 * catches it without rejecting real names.
 * @param raw - Raw name input.
 * @returns Whether the value is plausibly a name.
 */
export function isPlausibleName(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length < 2) return false;
  if (!/\p{L}/u.test(trimmed)) return false;
  if (/^\d+$/.test(trimmed)) return false;
  return true;
}
