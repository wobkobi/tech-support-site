// src/features/contacts/lib/merge-emails.ts
// Unions a contact's email addresses across the site and Google.
//
// Kept apart from google-contacts.ts so it can be exercised without pulling in
// googleapis, and because both sync directions need the same answer: the import
// folds Google's extra addresses into altEmails, and the push writes the whole
// list back rather than replacing Google's with a single address.

/**
 * Merges site and Google email lists into one ordered, de-duplicated list.
 *
 * Everything is lowercased, matching how `Contact.altEmails` is stored and how
 * the sync already compares emails - a case-only difference is the same
 * address, not a change. `primary` leads when present, because
 * `Contact.email` is the display and send address rather than just one of a
 * set; Google's order is otherwise preserved, then site-only addresses follow.
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
