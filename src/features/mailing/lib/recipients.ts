// src/features/mailing/lib/recipients.ts
// Who a mailing-list email goes to: live, subscribed contacts with an email, less anyone
// unticked. "Site reviewers" also skips anyone who stopped review asks.

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
  /** Set on an opted-out contact when Resend took them off: a bounce or a spam report. */
  optOutReason?: DeliveryOptOut;
}

/** Opt-out sources that came from Resend rather than the reader. */
export type DeliveryOptOut = "bounce" | "complaint";

/** An opt-out row as the selection reads it. */
export interface OptOutEntry {
  email: string;
  contactId: string | null;
  source?: string;
}

/**
 * The opt-out source when it came from Resend.
 * @param source - The row's source.
 * @returns The delivery reason, or undefined for the reader's own unsubscribe.
 */
function deliveryReason(source: string | undefined): DeliveryOptOut | undefined {
  return source === "bounce" || source === "complaint" ? source : undefined;
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
 * Splits the pool into recipients, unticked and unsubscribed. An opted-out address OR
 * contact id counts (the id survives an email change); a shared address gets one copy.
 * @param pool - Live contacts.
 * @param optOuts - Opt-out rows.
 * @param excludedIds - Contact ids unticked in the send dialog.
 * @param onlyIds - When given, contacts outside it are left out of every group.
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
  // Why Resend took an address or contact off, for the Subscribers list.
  const reasons = new Map<string, DeliveryOptOut>();
  for (const o of optOuts) {
    const reason = deliveryReason(o.source);
    if (!reason) continue;
    reasons.set(normaliseEmail(o.email), reason);
    if (o.contactId) reasons.set(o.contactId, reason);
  }
  const seen = new Set<string>();
  const result: RecipientSelection = { recipients: [], excluded: [], optedOut: [] };

  for (const contact of pool) {
    if (onlyIds && !onlyIds.has(contact.id)) continue;
    const email = normaliseEmail(contact.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const entry: Recipient = { contactId: contact.id, name: contact.name, email };
    if (optedOutEmails.has(email) || optedOutIds.has(contact.id)) {
      const optOutReason = reasons.get(email) ?? reasons.get(contact.id);
      result.optedOut.push(optOutReason ? { ...entry, optOutReason } : entry);
    } else if (excludedIds.has(contact.id)) result.excluded.push(entry);
    else result.recipients.push(entry);
  }
  return result;
}

/**
 * Each live contact's latest site review, matched by contactId or by customerRef against
 * the contact's current or merged review tokens.
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
    prisma.emailOptOut.findMany({ select: { email: true, contactId: true, source: true } }),
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
