// src/shared/lib/normalise-name.ts
// Light-touch cleanup + plausibility check for customer-entered names. Names are
// otherwise stored exactly as typed, so casing/spacing drift ("john   SMITH")
// and obvious junk ("a", "123") get through. Deliberately conservative: it never
// rejects a name that could be real and never re-cases intentional mixed case.

/**
 * Re-cases a single name token only when it carries no intentional casing
 * (entirely lower "john" or entirely upper "SMITH"); mixed case ("McDonald",
 * "DeVries", "O'Brien") is returned untouched. Capitalises each
 * hyphen/apostrophe-separated part so "mary-jane" > "Mary-Jane".
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
 * Tidies a customer name: collapses runs of whitespace and re-cases only tokens
 * that are entirely one case ("john" > "John", "SMITH" > "Smith"). Tokens with
 * intentional mixed case ("McDonald", "DeVries", "O'Brien") are left as typed so
 * real names aren't mangled.
 * @param raw - Raw name input.
 * @returns Tidied name, or empty string when the input is blank.
 */
export function normaliseName(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  return collapsed.split(" ").map(recaseToken).join(" ");
}

/**
 * Cheap sanity check that an entered name could plausibly be real. Requires at
 * least two trimmed characters, at least one letter, and rejects digits-only
 * input. Kept lenient on purpose: gibberish like "asdf" is accepted because no
 * rule catches it without also rejecting genuine short or unusual names.
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
