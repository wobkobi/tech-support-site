// src/features/admin/lib/auto-maintain.ts
/**
 * @description Server-side maintenance tasks that run on every admin page load.
 * Operations are idempotent and fast when there is nothing to do.
 */

import type { ConflictEntry } from "@/app/api/admin/contacts/enrich-from-reviews/route";
import { normalisePhone, toE164NZ } from "@/shared/lib/normalise-phone";
import type { PrismaClient } from "@prisma/client";

/**
 * Runs all maintenance tasks in order:
 * 1. Migrates legacy ReviewRequest send state onto Contact (one-shot per row, idempotent).
 * 2. Creates Contact records for any booking email not yet in the DB.
 * 3. Links Review records to their matching Contact by email or phone.
 * 4. Auto-fills missing contact fields from bookings.
 * Returns conflict entries (differing values) for the admin to resolve.
 * @param prisma - Prisma client instance.
 * @returns Array of conflict entries for admin resolution.
 */
export async function autoMaintain(prisma: PrismaClient): Promise<ConflictEntry[]> {
  // Migration runs first so subsequent steps see the unified Contact state.
  await migrateReviewRequestsToContacts(prisma);
  await backfillContacts(prisma);
  await matchReviewContacts(prisma);
  return autoEnrich(prisma);
}

/**
 * Lifts ReviewRequest state onto Contact. The ReviewRequest model is no
 * longer in the Prisma schema, so the orphaned collection is read via raw
 * MongoDB to bridge any pre-retirement rows into Contact fields. For each
 * row with a resolvable contact, sets
 * Contact.reviewToken (only if null), Contact.reviewLinkSentAt (only if
 * older or null), Contact.reviewLinkSentMode (when missing), and
 * Contact.reviewLinkSubmittedAt (when newer or null). Idempotent.
 * @param prisma - Prisma client instance.
 */
async function migrateReviewRequestsToContacts(prisma: PrismaClient): Promise<void> {
  interface OrphanedRR {
    _id: { $oid: string } | string;
    contactId?: { $oid: string } | string | null;
    email?: string | null;
    phone?: string | null;
    reviewToken: string;
    reviewSubmittedAt?: { $date: string } | Date | null;
    createdAt: { $date: string } | Date;
  }

  // Read orphaned ReviewRequest rows
  let rrs: OrphanedRR[] = [];
  try {
    const result = (await prisma.$runCommandRaw({
      find: "ReviewRequest",
      filter: {},
    })) as { cursor?: { firstBatch?: OrphanedRR[] } };
    rrs = result.cursor?.firstBatch ?? [];
  } catch {
    // Collection doesn't exist (fresh DB or already cleaned up) - nothing to do.
    return;
  }
  if (rrs.length === 0) return;

  // Build contact lookup maps
  const contacts = await prisma.contact.findMany({
    select: {
      id: true,
      email: true,
      phone: true,
      reviewToken: true,
      reviewLinkSentAt: true,
      reviewLinkSubmittedAt: true,
    },
  });
  const contactById = new Map(contacts.map((c) => [c.id, c]));
  const contactByEmail = new Map(
    contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]),
  );
  const contactByPhone = new Map<string, (typeof contacts)[number]>();
  for (const c of contacts) {
    if (c.phone) {
      const norm = normalisePhone(toE164NZ(c.phone) || c.phone);
      if (norm) contactByPhone.set(norm, c);
    }
  }

  /**
   * Pulls an ObjectId hex string out of the extended-JSON shape Mongo's raw
   * cursor returns. The driver sometimes returns `{ $oid: "..." }` and
   * sometimes the bare string, depending on the call site.
   * @param v - Raw value from the cursor (string, extended-JSON object, or null).
   * @returns The hex id, or null when the input is missing.
   */
  function unwrapOid(v: OrphanedRR["contactId"]): string | null {
    if (!v) return null;
    if (typeof v === "string") return v;
    return v.$oid;
  }
  /**
   * Coerces an extended-JSON date (or already-Date) into a Date object.
   * @param v - Raw date value from the cursor.
   * @returns Date instance.
   */
  function unwrapDate(v: OrphanedRR["createdAt"]): Date {
    if (v instanceof Date) return v;
    return new Date(v.$date);
  }

  // Lift each row's send state onto its contact
  for (const rr of rrs) {
    const rrContactId = unwrapOid(rr.contactId ?? null);
    const contact = rrContactId
      ? contactById.get(rrContactId)
      : ((rr.email ? contactByEmail.get(rr.email.toLowerCase()) : undefined) ??
        (rr.phone
          ? contactByPhone.get(normalisePhone(toE164NZ(rr.phone) || rr.phone) ?? "")
          : undefined));
    if (!contact) continue;

    const createdAt = unwrapDate(rr.createdAt);
    const submittedAt = rr.reviewSubmittedAt ? unwrapDate(rr.reviewSubmittedAt) : null;

    const update: {
      reviewToken?: string;
      reviewLinkSentAt?: Date;
      reviewLinkSentMode?: "email" | "sms";
      reviewLinkSubmittedAt?: Date;
    } = {};

    if (!contact.reviewToken && rr.reviewToken) update.reviewToken = rr.reviewToken;
    if (!contact.reviewLinkSentAt || contact.reviewLinkSentAt < createdAt) {
      update.reviewLinkSentAt = createdAt;
      update.reviewLinkSentMode = rr.email ? "email" : rr.phone ? "sms" : undefined;
    }
    if (
      submittedAt &&
      (!contact.reviewLinkSubmittedAt || contact.reviewLinkSubmittedAt < submittedAt)
    ) {
      update.reviewLinkSubmittedAt = submittedAt;
    }

    if (Object.keys(update).length === 0) continue;

    await prisma.contact.update({ where: { id: contact.id }, data: update }).catch(() => null);
  }
}

/**
 * Creates a Contact for every unique email found in Booking records that does
 * not already have a corresponding Contact. Also merges phone-only contacts
 * into their email-based counterpart when both share the same phone number.
 * Existing contacts are never overwritten - admin edits are the source of truth.
 * @param prisma - Prisma client instance.
 */
async function backfillContacts(prisma: PrismaClient): Promise<void> {
  const [bookings, allContacts] = await Promise.all([
    prisma.booking.findMany({
      orderBy: { createdAt: "asc" },
      select: { name: true, email: true, phone: true, notes: true },
    }),
    prisma.contact.findMany({ select: { id: true, email: true, phone: true, name: true } }),
  ]);

  // --- Step 1: Merge phone-only contacts into their email-based counterpart ---
  // Build buckets keyed by normalised phone: { withEmail, phoneOnly[] }
  const phoneBuckets = new Map<
    string,
    {
      withEmail: (typeof allContacts)[number] | null;
      phoneOnly: (typeof allContacts)[number][];
    }
  >();
  for (const c of allContacts) {
    if (!c.phone) continue;
    const norm = normalisePhone(toE164NZ(c.phone) || c.phone);
    if (!norm) continue;
    if (!phoneBuckets.has(norm)) phoneBuckets.set(norm, { withEmail: null, phoneOnly: [] });
    const bucket = phoneBuckets.get(norm)!;
    if (c.email) bucket.withEmail ??= c;
    else bucket.phoneOnly.push(c);
  }

  const deletedIds = new Set<string>();
  for (const { withEmail, phoneOnly } of phoneBuckets.values()) {
    if (!withEmail || phoneOnly.length === 0) continue;
    for (const dup of phoneOnly) {
      await prisma.review
        .updateMany({ where: { contactId: dup.id }, data: { contactId: withEmail.id } })
        .catch(() => null);
      await prisma.contact.delete({ where: { id: dup.id } }).catch(() => null);
      deletedIds.add(dup.id);
    }
  }

  // Work with the post-merge contact list so the sets below are accurate
  const existing = allContacts.filter((c) => !deletedIds.has(c.id));

  const existingEmails = new Set(
    existing.filter((c) => c.email).map((c) => c.email!.toLowerCase()),
  );
  // Remaining phone-only contacts (post-merge) - used to merge-on-create below
  const phoneOnlyByNorm = new Map<string, (typeof existing)[number]>();
  for (const c of existing) {
    if (!c.email && c.phone) {
      const norm = normalisePhone(toE164NZ(c.phone) || c.phone);
      if (norm) phoneOnlyByNorm.set(norm, c);
    }
  }

  const toCreateByEmail = new Map<
    string,
    { name: string; email: string; phone: string | null; address: string | null }
  >();

  // Bookings sorted asc - most recent overwrites earlier entries in the Map
  for (const b of bookings) {
    const email = b.email.toLowerCase();
    if (existingEmails.has(email)) continue;
    const address = b.notes?.match(/Address:\s*(.+)/i)?.[1]?.trim() ?? null;
    toCreateByEmail.set(email, { name: b.name, email, phone: b.phone ?? null, address });
  }

  if (toCreateByEmail.size === 0) return;

  await Promise.all(
    [...toCreateByEmail.values()].map(async (d) => {
      // If a phone-only contact already has this phone, merge email into it rather than
      // creating a duplicate contact.
      if (d.phone) {
        const norm = normalisePhone(toE164NZ(d.phone) || d.phone);
        const phoneOnlyMatch = norm ? phoneOnlyByNorm.get(norm) : undefined;
        if (phoneOnlyMatch) {
          const updates: { email: string; name?: string; address?: string } = { email: d.email };
          if (d.name.toLowerCase().startsWith(phoneOnlyMatch.name.toLowerCase() + " ")) {
            updates.name = d.name;
          }
          if (d.address) updates.address = d.address;
          return prisma.contact
            .update({ where: { id: phoneOnlyMatch.id }, data: updates })
            .catch(() => null);
        }
      }
      return prisma.contact
        .findFirst({ where: { email: d.email } })
        .then((exists) => (exists ? null : prisma.contact.create({ data: d })))
        .catch(() => null);
    }),
  );
}

/**
 * Links Review records that have no contactId to their matching Contact.
 * Booking-linked reviews resolve via the booking's email/phone; standalone
 * reviews resolve by their customerRef matching Contact.reviewToken.
 * @param prisma - Prisma client instance.
 */
async function matchReviewContacts(prisma: PrismaClient): Promise<void> {
  // MongoDB gotcha: `contactId: null` only matches documents where the field
  // exists and equals null. Reviews created before contactId was added to the
  // schema have no contactId field at all, so they need the `isSet: false`
  // branch to be matched and eligible for auto-linking.
  const unlinked = await prisma.review.findMany({
    where: { OR: [{ contactId: null }, { contactId: { isSet: false } }] },
    select: { id: true, bookingId: true, customerRef: true },
  });

  if (unlinked.length === 0) return;

  const bookingIds = unlinked.map((r) => r.bookingId).filter((id): id is string => id !== null);

  // Fetch related bookings and contacts
  const [bookingRows, contacts] = await Promise.all([
    bookingIds.length > 0
      ? prisma.booking.findMany({
          where: { id: { in: bookingIds } },
          select: { id: true, email: true, phone: true },
        })
      : Promise.resolve([]),
    prisma.contact.findMany({
      select: { id: true, email: true, phone: true, reviewToken: true },
    }),
  ]);

  // Build lookup maps
  const bookingEmailById = new Map(bookingRows.map((b) => [b.id, b.email.toLowerCase()]));
  const bookingPhoneById = new Map<string, string>();
  for (const b of bookingRows) {
    if (b.phone) {
      const norm = normalisePhone(toE164NZ(b.phone) || b.phone);
      if (norm) bookingPhoneById.set(b.id, norm);
    }
  }

  const contactIdByEmail = new Map(
    contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c.id]),
  );
  const contactIdByPhone = new Map<string, string>();
  for (const c of contacts) {
    if (c.phone) {
      const norm = normalisePhone(toE164NZ(c.phone) || c.phone);
      if (norm && !contactIdByPhone.has(norm)) contactIdByPhone.set(norm, c.id);
    }
  }
  const contactIdByToken = new Map(
    contacts.filter((c) => c.reviewToken).map((c) => [c.reviewToken!, c.id]),
  );

  // Link each review to its contact
  await Promise.all(
    unlinked.map(async (r) => {
      let contactId: string | undefined;

      if (r.bookingId) {
        const email = bookingEmailById.get(r.bookingId);
        if (email) contactId = contactIdByEmail.get(email);
        if (!contactId) {
          const phone = bookingPhoneById.get(r.bookingId);
          if (phone) contactId = contactIdByPhone.get(phone);
        }
      } else if (r.customerRef) {
        contactId = contactIdByToken.get(r.customerRef);
      }

      if (!contactId) return;
      await prisma.review.update({ where: { id: r.id }, data: { contactId } }).catch(() => null);
    }),
  );
}

/**
 * Auto-fills missing contact fields (phone, address) from the most recent
 * matching Booking. Returns a list of conflicts where existing contact data
 * differs from the source data.
 * @param prisma - Prisma client instance.
 * @returns Array of conflicts for admin resolution.
 */
async function autoEnrich(prisma: PrismaClient): Promise<ConflictEntry[]> {
  const [contacts, bookings] = await Promise.all([
    prisma.contact.findMany({
      select: { id: true, name: true, email: true, phone: true, address: true },
    }),
    prisma.booking.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, email: true, phone: true, notes: true },
    }),
  ]);

  // Build contact lookup maps
  const contactByEmail = new Map(
    contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]),
  );
  const contactByPhone = new Map<string, (typeof contacts)[0]>();
  for (const c of contacts) {
    if (c.phone) {
      const norm = normalisePhone(toE164NZ(c.phone) || c.phone);
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
    if (phone) {
      const norm = normalisePhone(toE164NZ(phone) || phone);
      if (norm) return contactByPhone.get(norm);
    }
    return undefined;
  }

  // Update and conflict accumulators
  const conflicts: ConflictEntry[] = [];
  const conflictSeen = new Set<string>();
  const phoneFilled = new Set<string>();
  const nameFilled = new Set<string>();
  const addressFilled = new Set<string>();
  const phoneUpdates = new Map<string, string>();
  const nameUpdates = new Map<string, string>();
  const addressUpdates = new Map<string, string>();

  // Bookings - newest first per contact: fill phone + address, detect conflicts
  for (const booking of bookings) {
    const contact = findContact(booking.email, booking.phone);
    if (!contact) continue;

    const proposedPhoneRaw = booking.phone?.trim() ?? null;
    const proposedPhone = proposedPhoneRaw ? normalisePhone(proposedPhoneRaw) : null;
    const existingPhone = contact.phone ? normalisePhone(contact.phone) : null;
    const address = booking.notes?.match(/Address:\s*(.+)/i)?.[1]?.trim() ?? null;

    if (proposedPhone && !existingPhone && !phoneFilled.has(contact.id)) {
      phoneFilled.add(contact.id);
      phoneUpdates.set(contact.id, toE164NZ(proposedPhoneRaw!) || proposedPhoneRaw!);
    }

    if (address && !contact.address && !addressFilled.has(contact.id)) {
      addressFilled.add(contact.id);
      addressUpdates.set(contact.id, address);
    }

    // Auto-fill name when contact has only a first name and source provides full name.
    const proposedNameBooking = booking.name.trim();
    if (
      proposedNameBooking &&
      contact.name &&
      !nameFilled.has(contact.id) &&
      proposedNameBooking.toLowerCase().startsWith(contact.name.toLowerCase() + " ")
    ) {
      nameFilled.add(contact.id);
      nameUpdates.set(contact.id, proposedNameBooking);
    }

    if (!conflictSeen.has(contact.id)) {
      conflictSeen.add(contact.id);
      const conflictFields: ("name" | "phone")[] = [];
      const proposedName = proposedNameBooking;
      const contactNameLower = contact.name.toLowerCase();
      const proposedNameLower = proposedName.toLowerCase();
      // Only flag a name conflict when the proposed name is genuinely different -
      // not when it is simply the contact's first name without the last name.
      if (
        proposedName &&
        contact.name &&
        proposedNameLower !== contactNameLower &&
        !contactNameLower.startsWith(proposedNameLower + " ") &&
        !proposedNameLower.startsWith(contactNameLower + " ")
      ) {
        conflictFields.push("name");
      }
      if (proposedPhone && existingPhone && proposedPhone !== existingPhone) {
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
          sourcePhone: conflictFields.includes("phone") ? proposedPhoneRaw : null,
          conflictFields,
        });
      }
    }
  }

  // Merge per-field updates by contact id so each contact gets at most one
  // write (instead of up to three round-trips when phone/name/address all
  // changed in the same pass).
  const mergedUpdates = new Map<string, { phone?: string; name?: string; address?: string }>();
  for (const [id, phone] of phoneUpdates) {
    mergedUpdates.set(id, { ...mergedUpdates.get(id), phone });
  }
  for (const [id, name] of nameUpdates) {
    mergedUpdates.set(id, { ...mergedUpdates.get(id), name });
  }
  for (const [id, address] of addressUpdates) {
    mergedUpdates.set(id, { ...mergedUpdates.get(id), address });
  }
  await Promise.all(
    [...mergedUpdates.entries()].map(([id, data]) =>
      prisma.contact.update({ where: { id }, data }),
    ),
  );

  return conflicts;
}
