// src/features/mailing/lib/recipients.ts
// Who a mailing-list email goes to: every live contact with an email who hasn't
// unsubscribed, less anyone the operator unticked. The "site reviewers" audience narrows
// that to contacts who left a review on the site, and also leaves out anyone who stopped
// review asks, since that email is itself a review ask. The selection itself is pure so
// the check script can cover it without a database.

import type { CampaignAudience } from "@/features/mailing/lib/audience";
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
 * @param onlyIds - When given, contacts outside it are left out of every group (the
 *   audience narrowed the list, so they aren't "unticked" or "unsubscribed").
 * @returns The three groups.
 */
export function selectRecipients(
  pool: PoolContact[],
  optOuts: OptOutEntry[],
  excludedIds: ReadonlySet<string>,
  onlyIds?: ReadonlySet<string>,
): RecipientSelection {
  const optedOutEmails = new Set(optOuts.map((o) => normaliseEmail(o.email)));
  const optedOutIds = new Set(optOuts.flatMap((o) => (o.contactId ? [o.contactId] : [])));
  const seen = new Set<string>();
  const result: RecipientSelection = { recipients: [], excluded: [], optedOut: [] };

  for (const contact of pool) {
    if (onlyIds && !onlyIds.has(contact.id)) continue;
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
 * Each live contact's latest review from the site. A review belongs to a contact by its
 * contactId, or by its customerRef matching one of the contact's review tokens (current
 * or inherited through a merge); reviews left through an old booking link have only the
 * latter.
 * @param contactIds - Only these contacts; omitted for everyone.
 * @returns Map from contact id to review text.
 */
export async function loadReviewTexts(contactIds?: string[]): Promise<Map<string, string>> {
  const [reviews, contacts] = await Promise.all([
    prisma.review.findMany({
      orderBy: { createdAt: "desc" },
      select: { text: true, contactId: true, customerRef: true },
    }),
    prisma.contact.findMany({
      where: { deletedAt: null, ...(contactIds ? { id: { in: contactIds } } : {}) },
      select: { id: true, reviewToken: true, altReviewTokens: true },
    }),
  ]);
  const live = new Set(contacts.map((c) => c.id));
  const byToken = new Map<string, string>();
  for (const c of contacts) {
    for (const token of [c.reviewToken, ...c.altReviewTokens]) {
      if (token) byToken.set(token, c.id);
    }
  }
  const texts = new Map<string, string>();
  // Newest first, so the first text a contact meets is their latest.
  for (const review of reviews) {
    const owners = [
      review.contactId,
      review.customerRef ? byToken.get(review.customerRef) : undefined,
    ];
    for (const id of owners) {
      if (id && live.has(id) && !texts.has(id)) texts.set(id, review.text);
    }
  }
  return texts;
}

/**
 * Loads live contacts and opt-outs for the audience, then runs {@link selectRecipients}.
 * @param excludedIds - Contact ids unticked in the send dialog.
 * @param audience - Who the email goes to.
 * @returns The three groups, each sorted by name.
 */
export async function loadRecipients(
  excludedIds: string[] = [],
  audience: CampaignAudience = "everyone",
): Promise<RecipientSelection> {
  const reviewers = audience === "site_reviewers";
  const [pool, optOuts, reviewAskOptOuts, reviewTexts] = await Promise.all([
    prisma.contact.findMany({
      where: { deletedAt: null, email: { not: null } },
      select: { id: true, name: true, email: true, altEmails: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.emailOptOut.findMany({ select: { email: true, contactId: true } }),
    reviewers ? prisma.reviewAskOptOut.findMany({ select: { email: true, contactId: true } }) : [],
    reviewers ? loadReviewTexts() : null,
  ]);
  const selection = selectRecipients(
    pool,
    [...optOuts, ...reviewAskOptOuts],
    new Set(excludedIds),
    reviewTexts ? new Set(reviewTexts.keys()) : undefined,
  );
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
