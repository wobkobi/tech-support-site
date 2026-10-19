// src/features/contacts/lib/merge-emails.ts
// Unions a contact's email addresses across the site and Google for both sync directions.
// Kept apart from google-contacts.ts so it can be tested without googleapis.

/**
 * Merges site and Google email lists into one lowercased, de-duplicated list.
 * Order: `primary` (the send address), then Google's order, then site-only addresses.
 * @param siteEmails - The site's addresses (primary plus alts); nulls and blanks are ignored.
 * @param googleEmails - Every address Google holds for the contact.
 * @param primary - The address that should lead, if any.
 * @returns Lowercased, de-duplicated addresses, primary first.
 */
export function mergeEmails(
  siteEmails: Array<string | null>,
  googleEmails: string[],
  primary: string | null,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  /**
   * Adds one address if it is non-blank and not already present.
   * @param raw - Candidate address.
   */
  const add = (raw: string | null): void => {
    const value = raw?.trim().toLowerCase();
    if (!value || seen.has(value)) return;
    seen.add(value);
    result.push(value);
  };

  add(primary);
  for (const email of googleEmails) add(email);
  for (const email of siteEmails) add(email);
  return result;
}
