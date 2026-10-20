// src/features/contacts/lib/maintenance.ts
// Contact maintenance: booking backfill, duplicate merges (Google link, email, mobile), review
// linking and conflict surfacing. Every merge folds through one helper; readers skip soft-deleted rows.

import { optOutRepointOps } from "@/features/reviews/lib/review-ask-opt-out";
import { isNZMobileKey, normaliseContactPhone } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import type { ReviewLinkMode } from "@prisma/client";

/** A single field divergence between a Contact and a source record (Booking or Review). */
export interface ConflictEntry {
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  /** Where the conflicting data came from. */
  source: "Review" | "Booking";
  sourceId: string;
  /** Suggested name (present when name is a conflicting field). */
  sourceName: string | null;
  /** Suggested phone (present when phone is a conflicting field). */
  sourcePhone: string | null;
  conflictFields: ("name" | "phone")[];
}

/**
 * Address is stored in booking notes as "Address: ...". Pulls the value or null.
 * @param notes - Raw booking notes string (may be null).
 * @returns The parsed address, or null when absent.
 */
function parseAddressFromNotes(notes: string | null): string | null {
  return notes?.match(/Address:\s*(.+)/i)?.[1]?.trim() ?? null;
}

/**
 * Stamps an explicit `deletedAt: null` on any contact missing the field, since a
 * `deletedAt: null` filter doesn't match an absent Mongo key.
 * @returns The number of contacts normalised.
 */
export async function normaliseSoftDeleteField(): Promise<number> {
  const res = await prisma.contact.updateMany({
    where: { deletedAt: { isSet: false } },
    data: { deletedAt: null },
  });
  if (res.count > 0) {
    console.warn(`[contacts/maintenance] normalised deletedAt on ${res.count} contact(s)`);
  }
  return res.count;
}

/** Every field {@link foldContactInto} reads, shared by all three merge passes. */
const MERGE_SELECT = {
  id: true,
  email: true,
  altEmails: true,
  phone: true,
  altPhones: true,
  address: true,
  company: true,
  googleContactId: true,
  reviewToken: true,
  altReviewTokens: true,
  reviewLinkSentAt: true,
  reviewLinkSentMode: true,
  reviewLinkSubmittedAt: true,
  createdAt: true,
} as const;

/** The Contact fields {@link foldContactInto} needs from both rows. */
interface MergeableContact {
  id: string;
  email: string | null;
  altEmails: string[];
  phone: string | null;
  altPhones: string[];
  address: string | null;
  company: string | null;
  googleContactId: string | null;
  reviewToken: string | null;
  altReviewTokens: string[];
  reviewLinkSentAt: Date | null;
  reviewLinkSentMode: ReviewLinkMode | null;
  reviewLinkSubmittedAt: Date | null;
}

/**
 * Folds `dup` into `keeper` (blank-fill, union phones/emails/tokens) and hard-deletes it in one
 * transaction, since Review.contactId is a bare ObjectId nothing cleans up. Google is never
 * touched: dupes often share the keeper's googleContactId.
 * @param keeper - The row that survives; updated in place to reflect the merge.
 * @param dup - The row being merged away.
 * @returns Whether the merge committed.
 */
async function foldContactInto(keeper: MergeableContact, dup: MergeableContact): Promise<boolean> {
  const fill: Record<string, unknown> = {};
  if (!keeper.phone && dup.phone) fill.phone = dup.phone;
  if (!keeper.address && dup.address) fill.address = dup.address;
  if (!keeper.company && dup.company) fill.company = dup.company;
  if (!keeper.reviewToken && dup.reviewToken) fill.reviewToken = dup.reviewToken;
  // A phone-only keeper adopts the dup's email (reachable from the Google-link and mobile passes).
  if (!keeper.email && dup.email) fill.email = dup.email.toLowerCase();

  // Fold the dup's numbers into altPhones so they stay matchable locally.
  const keeperPrimary =
    normaliseContactPhone(fill.phone as string | undefined) ?? normaliseContactPhone(keeper.phone);
  const altSet = new Set(keeper.altPhones);
  for (const p of [dup.phone, ...dup.altPhones]) {
    const key = normaliseContactPhone(p);
    if (key && key !== keeperPrimary) altSet.add(key);
  }
  if (altSet.size !== keeper.altPhones.length) fill.altPhones = { set: [...altSet] };

  // Fold the dup's emails into altEmails, lowercased, excluding the primary.
  const keeperPrimaryEmail =
    ((fill.email as string | undefined) ?? keeper.email)?.toLowerCase() ?? null;
  const seenEmail = new Set<string>();
  const mergedAltEmails: string[] = [];
  for (const e of [...keeper.altEmails, dup.email, ...dup.altEmails]) {
    const lower = e?.toLowerCase();
    if (!lower || lower === keeperPrimaryEmail || seenEmail.has(lower)) continue;
    seenEmail.add(lower);
    mergedAltEmails.push(lower);
  }
  // Compare contents, not length: a dropped alt can be swapped one-for-one.
  const keeperAlts = keeper.altEmails.map((e) => e.toLowerCase());
  if (
    mergedAltEmails.length !== keeperAlts.length ||
    mergedAltEmails.some((e, i) => e !== keeperAlts[i])
  ) {
    fill.altEmails = { set: mergedAltEmails };
  }
  // Adopt the dup's Google link when the keeper has none.
  if (!keeper.googleContactId && dup.googleContactId) {
    fill.googleContactId = dup.googleContactId;
  }
  // Newer review-link ask wins (with its mode): the send cooldown and "already asked"
  // gate must see the latest one.
  if (
    dup.reviewLinkSentAt &&
    (!keeper.reviewLinkSentAt || dup.reviewLinkSentAt > keeper.reviewLinkSentAt)
  ) {
    fill.reviewLinkSentAt = dup.reviewLinkSentAt;
    fill.reviewLinkSentMode = dup.reviewLinkSentMode;
  }
  // Having reviewed is permanent, so either row saying so is enough.
  if (!keeper.reviewLinkSubmittedAt && dup.reviewLinkSubmittedAt) {
    fill.reviewLinkSubmittedAt = dup.reviewLinkSubmittedAt;
  }

  // Fold review tokens so links sent under the dup still resolve.
  const keeperToken = (fill.reviewToken as string | undefined) ?? keeper.reviewToken ?? null;
  const tokenSet = new Set(keeper.altReviewTokens);
  for (const t of [dup.reviewToken, ...dup.altReviewTokens]) {
    if (t && t !== keeperToken) tokenSet.add(t);
  }
  if (tokenSet.size !== keeper.altReviewTokens.length) {
    fill.altReviewTokens = { set: [...tokenSet] };
  }

  try {
    await prisma.$transaction([
      prisma.review.updateMany({
        where: { contactId: dup.id },
        data: { contactId: keeper.id },
      }),
      // ContactConflict.contactId has no relation, so nothing cascades on delete.
      prisma.contactConflict.updateMany({
        where: { contactId: dup.id },
        data: { contactId: keeper.id },
      }),
      ...optOutRepointOps(dup.id, keeper.id),
      ...(Object.keys(fill).length > 0
        ? [prisma.contact.update({ where: { id: keeper.id }, data: fill })]
        : []),
      prisma.contact.delete({ where: { id: dup.id } }),
    ]);
  } catch (err) {
    console.error(`[contacts/maintenance] merge of ${dup.id} into ${keeper.id} failed:`, err);
    return false;
  }

  if (fill.phone) keeper.phone = fill.phone as string;
  if (fill.address) keeper.address = fill.address as string;
  if (fill.company) keeper.company = fill.company as string;
  if (fill.reviewToken) keeper.reviewToken = fill.reviewToken as string;
  if (fill.reviewLinkSentAt) {
    keeper.reviewLinkSentAt = fill.reviewLinkSentAt as Date;
    keeper.reviewLinkSentMode = fill.reviewLinkSentMode as ReviewLinkMode | null;
  }
  if (fill.reviewLinkSubmittedAt) {
    keeper.reviewLinkSubmittedAt = fill.reviewLinkSubmittedAt as Date;
  }
  if (fill.email) keeper.email = fill.email as string;
  if (fill.googleContactId) keeper.googleContactId = fill.googleContactId as string;
  if (fill.altPhones) keeper.altPhones = [...altSet];
  if (fill.altEmails) keeper.altEmails = mergedAltEmails;
  if (fill.altReviewTokens) keeper.altReviewTokens = [...tokenSet];
  return true;
}

/**
 * Whether two contacts are linked to different Google contacts. Google keeps them as two
 * people, so a shared email or mobile is a mistake to fix by hand, not a duplicate: auto-merging
 * would fold one person's details into the other and push them to the wrong Google contact.
 * @param a - One contact.
 * @param b - The other contact.
 * @returns True when both have a Google link and the links differ.
 */
function separateInGoogle(a: MergeableContact, b: MergeableContact): boolean {
  return !!a.googleContactId && !!b.googleContactId && a.googleContactId !== b.googleContactId;
}

/**
 * Logs a pair the email or mobile pass left unmerged because Google keeps them apart.
 * @param keeper - The row that would have survived.
 * @param dup - The row that would have been merged away.
 * @param shared - What the two rows share, for the log line.
 */
function warnSeparateInGoogle(
  keeper: MergeableContact,
  dup: MergeableContact,
  shared: string,
): void {
  console.warn(
    `[contacts/maintenance] not merging ${dup.id} into ${keeper.id}: they share ${shared} but ` +
      "are separate Google contacts. Merge them by hand if they're the same person.",
  );
}

/**
 * Merges live contacts sharing a googleContactId (the strongest duplicate signal) into the oldest.
 * @returns The number of duplicate contacts merged away.
 */
export async function mergeDuplicateGoogleContacts(): Promise<number> {
  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null, googleContactId: { not: null } },
    select: MERGE_SELECT,
    orderBy: { createdAt: "asc" },
  });

  const byGoogleId = new Map<string, typeof contacts>();
  for (const c of contacts) {
    const key = c.googleContactId!;
    byGoogleId.set(key, [...(byGoogleId.get(key) ?? []), c]);
  }

  let merged = 0;
  for (const rows of byGoogleId.values()) {
    if (rows.length < 2) continue;
    // Oldest first (orderBy above): the original row is the keeper.
    const [keeper, ...dupes] = rows;
    if (!keeper) continue;
    for (const dup of dupes) {
      if (await foldContactInto(keeper, dup)) merged++;
    }
  }
  if (merged > 0) {
    console.warn(`[contacts/maintenance] merged ${merged} contact(s) sharing a Google link`);
  }
  return merged;
}

/**
 * Merges live contacts sharing a case-insensitive email into the oldest, which carries
 * the original reviewToken and history. Rows linked to different Google contacts are skipped.
 * @returns The number of duplicate contacts merged away.
 */
export async function mergeDuplicateEmailContacts(): Promise<number> {
  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null, email: { not: null } },
    select: MERGE_SELECT,
    orderBy: { createdAt: "asc" },
  });

  const byEmail = new Map<string, typeof contacts>();
  for (const c of contacts) {
    const key = c.email!.toLowerCase();
    byEmail.set(key, [...(byEmail.get(key) ?? []), c]);
  }

  let merged = 0;
  for (const rows of byEmail.values()) {
    if (rows.length < 2) continue;
    // Oldest first (orderBy above): the original row is the keeper.
    const [keeper, ...dupes] = rows;
    if (!keeper) continue;
    for (const dup of dupes) {
      if (separateInGoogle(keeper, dup)) {
        warnSeparateInGoogle(keeper, dup, "an email");
        continue;
      }
      if (await foldContactInto(keeper, dup)) merged++;
    }
  }
  if (merged > 0) {
    console.warn(`[contacts/maintenance] merged ${merged} duplicate-email contact(s)`);
  }
  return merged;
}

/**
 * Merges contacts sharing a mobile: phone-only rows fold into the email-bearing one, else
 * the oldest. Rows linked to different Google contacts are skipped. Runs before backfill so
 * the post-merge set is accurate.
 * @returns The set of contact ids that were merged away (deleted).
 */
export async function mergePhoneOnlyContacts(): Promise<Set<string>> {
  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null },
    select: MERGE_SELECT,
    orderBy: { createdAt: "asc" },
  });

  // Bucket by normalised phone (primary + alts), oldest first.
  const phoneBuckets = new Map<
    string,
    { withEmail: (typeof contacts)[number] | null; phoneOnly: (typeof contacts)[number][] }
  >();
  for (const c of contacts) {
    const keys = [normaliseContactPhone(c.phone), ...c.altPhones.map(normaliseContactPhone)];
    for (const norm of keys) {
      // Mobiles only: a household landline may belong to two people.
      if (!norm || !isNZMobileKey(norm)) continue;
      if (!phoneBuckets.has(norm)) phoneBuckets.set(norm, { withEmail: null, phoneOnly: [] });
      const bucket = phoneBuckets.get(norm)!;
      if (c.email) bucket.withEmail ??= c;
      else if (!bucket.phoneOnly.includes(c)) bucket.phoneOnly.push(c);
    }
  }

  const deletedIds = new Set<string>();
  for (const { withEmail, phoneOnly } of phoneBuckets.values()) {
    const keeper = withEmail ?? phoneOnly[0];
    const dupes = withEmail ? phoneOnly : phoneOnly.slice(1);
    if (!keeper || dupes.length === 0) continue;
    for (const dup of dupes) {
      // Two mobiles put a person in two buckets; skip a pair already merged away.
      if (deletedIds.has(keeper.id) || deletedIds.has(dup.id)) continue;
      if (separateInGoogle(keeper, dup)) {
        warnSeparateInGoogle(keeper, dup, "a mobile");
        continue;
      }
      if (await foldContactInto(keeper, dup)) deletedIds.add(dup.id);
    }
  }
  return deletedIds;
}

/**
 * Creates a Contact for each booking email with no live Contact. A soft-deleted match
 * suppresses re-creation; a phone-only mobile match gets the email instead.
 * @returns The number of contacts created.
 */
export async function backfillContactsFromBookings(): Promise<number> {
  const [bookings, allContacts] = await Promise.all([
    prisma.booking.findMany({
      orderBy: { createdAt: "asc" },
      select: { name: true, email: true, phone: true, notes: true },
    }),
    prisma.contact.findMany({
      select: { id: true, email: true, altEmails: true, phone: true, deletedAt: true },
    }),
  ]);

  const live = allContacts.filter((c) => !c.deletedAt);
  // Every email a live contact owns (primary + alts).
  const liveEmails = new Set<string>();
  for (const c of live) {
    if (c.email) liveEmails.add(c.email.toLowerCase());
    for (const alt of c.altEmails) liveEmails.add(alt.toLowerCase());
  }
  // Emails belonging to a soft-deleted contact - do NOT recreate these.
  const suppressedEmails = new Set<string>();
  for (const c of allContacts) {
    if (!c.deletedAt) continue;
    if (c.email) suppressedEmails.add(c.email.toLowerCase());
    for (const alt of c.altEmails) suppressedEmails.add(alt.toLowerCase());
  }

  const phoneOnlyByNorm = new Map<string, (typeof live)[number]>();
  for (const c of live) {
    if (c.email) continue;
    const norm = normaliseContactPhone(c.phone);
    // Mobiles only, as in mergePhoneOnlyContacts: a household landline may belong to two people.
    if (norm && isNZMobileKey(norm)) phoneOnlyByNorm.set(norm, c);
  }

  // Newest booking wins per email (Map overwrite as the ascending scan proceeds).
  const toCreateByEmail = new Map<
    string,
    { name: string; email: string; phone: string | null; address: string | null }
  >();
  for (const b of bookings) {
    const email = b.email.toLowerCase();
    if (liveEmails.has(email) || suppressedEmails.has(email)) continue;
    toCreateByEmail.set(email, {
      name: b.name,
      email,
      phone: b.phone ?? null,
      address: parseAddressFromNotes(b.notes),
    });
  }

  if (toCreateByEmail.size === 0) return 0;

  let created = 0;
  await Promise.all(
    [...toCreateByEmail.values()].map(async (d) => {
      // Merge the email into a matching phone-only contact rather than duplicating.
      const norm = normaliseContactPhone(d.phone);
      const phoneOnlyMatch = norm ? phoneOnlyByNorm.get(norm) : undefined;
      if (phoneOnlyMatch) {
        const updates: { email: string; address?: string } = { email: d.email };
        if (d.address) updates.address = d.address;
        await prisma.contact
          .update({ where: { id: phoneOnlyMatch.id }, data: updates })
          .catch(() => null);
        return;
      }
      const exists = await prisma.contact.findFirst({
        where: { email: { equals: d.email, mode: "insensitive" }, deletedAt: null },
        select: { id: true },
      });
      if (!exists) {
        await prisma.contact
          // Explicit null: `where: { deletedAt: null }` won't match an absent Mongo key.
          .create({ data: { ...d, deletedAt: null } })
          .then(() => (created += 1))
          .catch(() => null);
      }
    }),
  );
  return created;
}

/**
 * Links unlinked reviews to a Contact: booking reviews by email then phone, standalone ones by
 * customerRef > reviewToken. A phone shared by several contacts is logged and left unlinked.
 * @returns The number of reviews newly linked.
 */
export async function matchReviewsToContacts(): Promise<number> {
  // `contactId: null` misses rows with no field at all, hence the OR.
  const unlinked = await prisma.review.findMany({
    where: { OR: [{ contactId: null }, { contactId: { isSet: false } }] },
    select: { id: true, bookingId: true, customerRef: true },
  });
  if (unlinked.length === 0) return 0;

  const bookingIds = unlinked.map((r) => r.bookingId).filter((id): id is string => id !== null);
  const [bookingRows, contacts] = await Promise.all([
    bookingIds.length > 0
      ? prisma.booking.findMany({
          where: { id: { in: bookingIds } },
          select: { id: true, email: true, phone: true },
        })
      : Promise.resolve([]),
    prisma.contact.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        email: true,
        altEmails: true,
        phone: true,
        altPhones: true,
        reviewToken: true,
        altReviewTokens: true,
      },
    }),
  ]);

  const bookingEmailById = new Map(bookingRows.map((b) => [b.id, b.email.toLowerCase()]));
  const bookingPhoneById = new Map<string, string>();
  for (const b of bookingRows) {
    const norm = normaliseContactPhone(b.phone);
    if (norm) bookingPhoneById.set(b.id, norm);
  }

  // Index every email a contact owns (primary + alts).
  const contactIdByEmail = new Map<string, string>();
  for (const c of contacts) {
    if (c.email) contactIdByEmail.set(c.email.toLowerCase(), c.id);
    for (const alt of c.altEmails) contactIdByEmail.set(alt.toLowerCase(), c.id);
  }
  // ALL contact ids per phone, so shared numbers can be flagged ambiguous.
  const contactIdsByPhone = new Map<string, string[]>();
  for (const c of contacts) {
    const keys = new Set(
      [normaliseContactPhone(c.phone), ...c.altPhones.map(normaliseContactPhone)].filter(
        (k): k is string => !!k,
      ),
    );
    for (const norm of keys) {
      const list = contactIdsByPhone.get(norm) ?? [];
      list.push(c.id);
      contactIdsByPhone.set(norm, list);
    }
  }
  // Primary and merge-folded tokens, so a merged-away contact's old link resolves.
  const contactIdByToken = new Map<string, string>();
  for (const c of contacts) {
    if (c.reviewToken) contactIdByToken.set(c.reviewToken, c.id);
    for (const t of c.altReviewTokens) contactIdByToken.set(t, c.id);
  }

  let linked = 0;
  await Promise.all(
    unlinked.map(async (r) => {
      let contactId: string | undefined;
      if (r.bookingId) {
        const email = bookingEmailById.get(r.bookingId);
        if (email) contactId = contactIdByEmail.get(email);
        if (!contactId) {
          const phone = bookingPhoneById.get(r.bookingId);
          if (phone) {
            const candidates = contactIdsByPhone.get(phone);
            if (candidates && candidates.length > 1) {
              console.warn(
                `[contacts/maintenance] Ambiguous phone ${phone} for review ${r.id}: ` +
                  `${candidates.length} contacts share it (${candidates.join(", ")}). ` +
                  `Left unlinked - merge the duplicates to resolve.`,
              );
            } else if (candidates) {
              contactId = candidates[0];
            }
          }
        }
      } else if (r.customerRef) {
        contactId = contactIdByToken.get(r.customerRef);
      }
      if (!contactId) return;
      await prisma.review
        .update({ where: { id: r.id }, data: { contactId } })
        .then(() => (linked += 1))
        .catch(() => null);
    }),
  );
  return linked;
}

/**
 * Trims a name and collapses whitespace runs (including non-breaking spaces) to one space.
 * @param name - Raw name.
 * @returns The name with surrounding and repeated whitespace normalised.
 */
function collapseWhitespace(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}
/**
 * Fills missing phone, address and full name on live contacts from the latest matching
 * Booking, and returns booking-sourced conflicts.
 * @returns Booking-sourced conflict entries.
 */
export async function enrichContactsFromBookings(): Promise<ConflictEntry[]> {
  const [contacts, bookings] = await Promise.all([
    prisma.contact.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        altEmails: true,
        phone: true,
        altPhones: true,
        address: true,
      },
    }),
    prisma.booking.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, email: true, phone: true, notes: true },
    }),
  ]);

  const contactByEmail = new Map<string, (typeof contacts)[number]>();
  for (const c of contacts) {
    if (c.email) contactByEmail.set(c.email.toLowerCase(), c);
    for (const alt of c.altEmails) contactByEmail.set(alt.toLowerCase(), c);
  }
  const contactByPhone = new Map<string, (typeof contacts)[0]>();
  for (const c of contacts) {
    for (const raw of [c.phone, ...c.altPhones]) {
      const norm = normaliseContactPhone(raw);
      if (norm && !contactByPhone.has(norm)) contactByPhone.set(norm, c);
    }
  }

  /**
   * Finds a contact by email (primary) or normalised phone (fallback).
   * @param email - Email to look up.
   * @param phone - Phone to fall back to.
   * @returns Matching contact or undefined.
   */
  function findContact(
    email: string | null | undefined,
    phone: string | null | undefined,
  ): (typeof contacts)[0] | undefined {
    if (email) {
      const c = contactByEmail.get(email.toLowerCase());
      if (c) return c;
    }
    const norm = normaliseContactPhone(phone);
    if (norm) return contactByPhone.get(norm);
    return undefined;
  }

  const conflicts: ConflictEntry[] = [];
  const conflictSeen = new Set<string>();
  const phoneFilled = new Set<string>();
  const nameFilled = new Set<string>();
  const addressFilled = new Set<string>();
  const phoneUpdates = new Map<string, string>();
  const nameUpdates = new Map<string, string>();
  const addressUpdates = new Map<string, string>();

  for (const booking of bookings) {
    const contact = findContact(booking.email, booking.phone);
    if (!contact) continue;

    const proposedPhone = normaliseContactPhone(booking.phone);
    const existingPhone = normaliseContactPhone(contact.phone);
    const address = parseAddressFromNotes(booking.notes);

    if (proposedPhone && !existingPhone && !phoneFilled.has(contact.id)) {
      phoneFilled.add(contact.id);
      phoneUpdates.set(contact.id, proposedPhone);
    }
    if (address && !contact.address && !addressFilled.has(contact.id)) {
      addressFilled.add(contact.id);
      addressUpdates.set(contact.id, address);
    }

    // Compare names whitespace-normalised so cosmetic spacing is not a difference.
    const proposedName = collapseWhitespace(booking.name);
    const contactName = collapseWhitespace(contact.name);
    // Fill name when contact has only a first name and the booking has the full one.
    if (
      proposedName &&
      contactName &&
      !nameFilled.has(contact.id) &&
      proposedName.toLowerCase().startsWith(contactName.toLowerCase() + " ")
    ) {
      nameFilled.add(contact.id);
      nameUpdates.set(contact.id, proposedName);
    }

    if (!conflictSeen.has(contact.id)) {
      conflictSeen.add(contact.id);
      const conflictFields: ("name" | "phone")[] = [];
      const contactNameLower = contactName.toLowerCase();
      const proposedNameLower = proposedName.toLowerCase();
      // Only a genuine difference is a conflict - not merely a missing last name.
      if (
        proposedName &&
        contactName &&
        proposedNameLower !== contactNameLower &&
        !contactNameLower.startsWith(proposedNameLower + " ") &&
        !proposedNameLower.startsWith(contactNameLower + " ")
      ) {
        conflictFields.push("name");
      }
      // Only a number matching none of the contact's phones is a conflict.
      const knownPhones = new Set(
        [existingPhone, ...contact.altPhones.map(normaliseContactPhone)].filter(Boolean),
      );
      if (proposedPhone && existingPhone && !knownPhones.has(proposedPhone)) {
        conflictFields.push("phone");
      }
      if (conflictFields.length > 0) {
        conflicts.push({
          contactId: contact.id,
          contactName: contact.name,
          contactEmail: contact.email,
          contactPhone: contact.phone,
          source: "Booking",
          sourceId: booking.id,
          sourceName: conflictFields.includes("name") ? proposedName : null,
          sourcePhone: conflictFields.includes("phone") ? (booking.phone?.trim() ?? null) : null,
          conflictFields,
        });
      }
    }
  }

  // One write per contact - merge the per-field updates first.
  const mergedUpdates = new Map<string, { phone?: string; name?: string; address?: string }>();
  for (const [id, phone] of phoneUpdates)
    mergedUpdates.set(id, { ...mergedUpdates.get(id), phone });
  for (const [id, name] of nameUpdates) mergedUpdates.set(id, { ...mergedUpdates.get(id), name });
  for (const [id, address] of addressUpdates)
    mergedUpdates.set(id, { ...mergedUpdates.get(id), address });
  await Promise.all(
    [...mergedUpdates.entries()].map(([id, data]) =>
      prisma.contact.update({ where: { id }, data }).catch(() => null),
    ),
  );

  return conflicts;
}

/**
 * Returns a name conflict per contact whose customerRef review gives a different full name.
 * A first-name-only review is skipped.
 * @returns Review-sourced conflict entries.
 */
export async function enrichContactsFromReviews(): Promise<ConflictEntry[]> {
  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      reviewToken: true,
      altReviewTokens: true,
    },
  });
  const contactByToken = new Map<string, (typeof contacts)[number]>();
  for (const c of contacts) {
    if (c.reviewToken) contactByToken.set(c.reviewToken, c);
    for (const t of c.altReviewTokens) contactByToken.set(t, c);
  }

  const reviews = await prisma.review.findMany({
    where: { customerRef: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, firstName: true, lastName: true, customerRef: true },
  });

  const conflicts: ConflictEntry[] = [];
  const seen = new Set<string>();
  for (const review of reviews) {
    if (!review.customerRef) continue;
    const contact = contactByToken.get(review.customerRef);
    if (!contact || seen.has(contact.id)) continue;
    seen.add(contact.id);

    if (!review.lastName) continue;
    // Whitespace-normalised on both sides so cosmetic spacing is not a difference.
    const proposedName = collapseWhitespace(
      [review.firstName, review.lastName].filter(Boolean).join(" "),
    );
    const contactName = collapseWhitespace(contact.name);
    if (!proposedName || !contactName) continue;
    if (proposedName.toLowerCase() === contactName.toLowerCase()) continue;

    conflicts.push({
      contactId: contact.id,
      contactName: contact.name,
      contactEmail: contact.email,
      contactPhone: contact.phone,
      source: "Review",
      sourceId: review.id,
      sourceName: proposedName,
      sourcePhone: null,
      conflictFields: ["name"],
    });
  }
  return conflicts;
}
