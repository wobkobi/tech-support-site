// src/features/mailing/lib/recipients.ts
// Who a mailing-list email goes to: every live contact with an email who hasn't
// unsubscribed, less anyone the operator unticked. The selection itself is pure so the
// check script can cover it without a database.

import { normaliseEmail } from "@/shared/lib/normalise-email";
import { prisma } from "@/shared/lib/prisma";

/** The contact fields recipient selection reads. */
export interface PoolContact {
  id: string;
  name: string;
  email: string | null;
  altEmails: string[];
}

/** One recipient, with the address the email goes to. */
export interface Recipient {
  contactId: string;
  name: string;
  email: string;
}

/** An opt-out row as the selection reads it. */
export interface OptOutEntry {
  email: string;
  contactId: string | null;
}

/** Result of {@link selectRecipients}. */
export interface RecipientSelection {
  /** Who gets the email. */
  recipients: Recipient[];
  /** Subscribed contacts the operator unticked. */
  excluded: Recipient[];
  /** Contacts who have unsubscribed. */
  optedOut: Recipient[];
}

/**
 * Splits the contact pool into recipients, unticked contacts and unsubscribed
 * ones. A contact counts as unsubscribed when their primary address OR their
 * contact id is on the opt-out list: the id catches someone who unsubscribed
 * and later had their email changed. Two contacts sharing an address get one
 * copy, sent to whichever comes first.
 * @param pool - Live contacts.
 * @param optOuts - Opt-out rows.
 * @param excludedIds - Contact ids unticked in the send dialog.
 * @returns The three groups.
 */
export function selectRecipients(
  pool: PoolContact[],
  optOuts: OptOutEntry[],
  excludedIds: ReadonlySet<string>,
): RecipientSelection {
  const optedOutEmails = new Set(optOuts.map((o) => normaliseEmail(o.email)));
  const optedOutIds = new Set(optOuts.flatMap((o) => (o.contactId ? [o.contactId] : [])));
  const seen = new Set<string>();
  const result: RecipientSelection = { recipients: [], excluded: [], optedOut: [] };

  for (const contact of pool) {
    const email = normaliseEmail(contact.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const entry: Recipient = { contactId: contact.id, name: contact.name, email };
    if (optedOutEmails.has(email) || optedOutIds.has(contact.id)) result.optedOut.push(entry);
    else if (excludedIds.has(contact.id)) result.excluded.push(entry);
    else result.recipients.push(entry);
  }
  return result;
}

/**
 * Loads live contacts and opt-outs, then runs {@link selectRecipients}.
 * @param excludedIds - Contact ids unticked in the send dialog.
 * @returns The three groups, each sorted by name.
 */
export async function loadRecipients(excludedIds: string[] = []): Promise<RecipientSelection> {
  const [pool, optOuts] = await Promise.all([
    prisma.contact.findMany({
      where: { deletedAt: null, email: { not: null } },
      select: { id: true, name: true, email: true, altEmails: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.emailOptOut.findMany({ select: { email: true, contactId: true } }),
  ]);
  const selection = selectRecipients(pool, optOuts, new Set(excludedIds));
  /**
   * Alphabetical order by name.
   * @param a - First recipient.
   * @param b - Second recipient.
   * @returns Sort comparison.
   */
  const byName = (a: Recipient, b: Recipient): number => a.name.localeCompare(b.name);
  selection.recipients.sort(byName);
  selection.excluded.sort(byName);
  selection.optedOut.sort(byName);
  return selection;
}
