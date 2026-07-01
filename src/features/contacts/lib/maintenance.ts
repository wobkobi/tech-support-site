// src/features/contacts/lib/maintenance.ts
// Single source of truth for contact maintenance: backfilling contacts from
// bookings, merging phone-only duplicates, linking reviews to contacts, and
// surfacing field conflicts for the admin to resolve. Both the admin page load
// (auto-maintain) and the standalone admin routes call these - keeping the logic
// here is what stops the two paths from drifting apart. Every reader excludes
// soft-deleted contacts (deletedAt != null).

import { normaliseContactPhone } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";

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
 * Merges phone-only contacts into their email-bearing counterpart when both
 * share the same normalised phone: migrates the phone-only contact's reviews
 * onto the email contact, then deletes the phone-only row. Runs before backfill
 * so the post-merge contact set is accurate.
 * @returns The set of contact ids that were merged away (deleted).
 */
export async function mergePhoneOnlyContacts(): Promise<Set<string>> {
  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null },
    select: { id: true, email: true, phone: true, name: true },
  });

  // Bucket by normalised phone: one email-bearing "keeper" + any phone-only dups.
  const phoneBuckets = new Map<
    string,
    { withEmail: (typeof contacts)[number] | null; phoneOnly: (typeof contacts)[number][] }
  >();
  for (const c of contacts) {
    const norm = normaliseContactPhone(c.phone);
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
  return deletedIds;
}

/**
 * Creates a Contact for every unique booking email that has no live Contact yet.
 * A soft-deleted contact for that email suppresses re-creation (otherwise a
 * deleted contact would resurrect on the next run). When a booking's phone
 * matches an existing phone-only contact, the email is merged into it instead
 * of creating a duplicate.
 * @returns The number of contacts created.
 */
export async function backfillContactsFromBookings(): Promise<number> {
  const [bookings, allContacts] = await Promise.all([
    prisma.booking.findMany({
      orderBy: { createdAt: "asc" },
      select: { name: true, email: true, phone: true, notes: true },
    }),
    prisma.contact.findMany({ select: { id: true, email: true, phone: true, deletedAt: true } }),
  ]);

  const live = allContacts.filter((c) => !c.deletedAt);
  const liveEmails = new Set(live.filter((c) => c.email).map((c) => c.email!.toLowerCase()));
  // Emails belonging to a soft-deleted contact - do NOT recreate these.
  const suppressedEmails = new Set(
    allContacts.filter((c) => c.deletedAt && c.email).map((c) => c.email!.toLowerCase()),
  );

  const phoneOnlyByNorm = new Map<string, (typeof live)[number]>();
  for (const c of live) {
    if (c.email) continue;
    const norm = normaliseContactPhone(c.phone);
    if (norm) phoneOnlyByNorm.set(norm, c);
  }

  // Newest booking wins per email (Map overwrite as we iterate ascending).
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
          .create({ data: d })
          .then(() => (created += 1))
          .catch(() => null);
      }
    }),
  );
  return created;
}

/**
 * Links reviews with no contactId to their matching Contact. Booking-linked
 * reviews resolve via the booking's email (primary) or phone (fallback);
 * standalone reviews resolve by customerRef matching Contact.reviewToken.
 *
 * Ambiguous-phone guard: if a normalised phone maps to more than one live
 * contact, phone matching is skipped for that number (the review is left
 * unlinked) and the collision is logged, because silently linking to whichever
 * contact loaded first attaches the review to a possibly-wrong person.
 * @returns The number of reviews newly linked.
 */
export async function matchReviewsToContacts(): Promise<number> {
  // MongoDB gotcha: `contactId: null` only matches documents where the field
  // exists and equals null; pre-schema rows have no field at all, hence the OR.
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
      select: { id: true, email: true, phone: true, reviewToken: true },
    }),
  ]);

  const bookingEmailById = new Map(bookingRows.map((b) => [b.id, b.email.toLowerCase()]));
  const bookingPhoneById = new Map<string, string>();
  for (const b of bookingRows) {
    const norm = normaliseContactPhone(b.phone);
    if (norm) bookingPhoneById.set(b.id, norm);
  }

  const contactIdByEmail = new Map(
    contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c.id]),
  );
  // Collect ALL contact ids per phone so shared numbers can be flagged ambiguous.
  const contactIdsByPhone = new Map<string, string[]>();
  for (const c of contacts) {
    const norm = normaliseContactPhone(c.phone);
    if (!norm) continue;
    const list = contactIdsByPhone.get(norm) ?? [];
    list.push(c.id);
    contactIdsByPhone.set(norm, list);
  }
  const contactIdByToken = new Map(
    contacts.filter((c) => c.reviewToken).map((c) => [c.reviewToken!, c.id]),
  );

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
 * Auto-fills missing contact fields (phone, address, full name) from the most
 * recent matching Booking and returns booking-sourced field conflicts for the
 * admin to resolve. Only touches live contacts.
 * @returns Booking-sourced conflict entries.
 */
export async function enrichContactsFromBookings(): Promise<ConflictEntry[]> {
  const [contacts, bookings] = await Promise.all([
    prisma.contact.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, email: true, phone: true, address: true },
    }),
    prisma.booking.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, email: true, phone: true, notes: true },
    }),
  ]);

  const contactByEmail = new Map(
    contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]),
  );
  const contactByPhone = new Map<string, (typeof contacts)[0]>();
  for (const c of contacts) {
    const norm = normaliseContactPhone(c.phone);
    if (norm && !contactByPhone.has(norm)) contactByPhone.set(norm, c);
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

    // Fill name when contact has only a first name and the booking has the full one.
    const proposedName = booking.name.trim();
    if (
      proposedName &&
      contact.name &&
      !nameFilled.has(contact.id) &&
      proposedName.toLowerCase().startsWith(contact.name.toLowerCase() + " ")
    ) {
      nameFilled.add(contact.id);
      nameUpdates.set(contact.id, proposedName);
    }

    if (!conflictSeen.has(contact.id)) {
      conflictSeen.add(contact.id);
      const conflictFields: ("name" | "phone")[] = [];
      const contactNameLower = contact.name.toLowerCase();
      const proposedNameLower = proposedName.toLowerCase();
      // Only a genuine difference is a conflict - not merely a missing last name.
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
 * Compares reviews against their linked Contact and returns a name conflict per
 * contact where the reviewer's full name differs from the stored name. Only
 * reviews carrying a customerRef (standalone/contact-token reviews) are checked;
 * a review with only a first name is not treated as a suggestion to drop the
 * contact's last name.
 * @returns Review-sourced conflict entries.
 */
export async function enrichContactsFromReviews(): Promise<ConflictEntry[]> {
  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, email: true, phone: true, reviewToken: true },
  });
  const contactByToken = new Map(
    contacts.filter((c) => c.reviewToken).map((c) => [c.reviewToken!, c]),
  );

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
    const proposedName = [review.firstName, review.lastName].filter(Boolean).join(" ").trim();
    if (!proposedName || !contact.name) continue;
    if (proposedName.toLowerCase() === contact.name.toLowerCase()) continue;

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
