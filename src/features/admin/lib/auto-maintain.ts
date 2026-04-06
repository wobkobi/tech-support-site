// src/features/admin/lib/auto-maintain.ts
/**
 * @file auto-maintain.ts
 * @description Server-side maintenance tasks that run on every admin page load.
 * Operations are idempotent and fast when there is nothing to do.
 */

import type { PrismaClient } from "@prisma/client";
import { toE164NZ, normalizePhone } from "@/shared/lib/normalize-phone";
import type { ConflictEntry } from "@/app/api/admin/contacts/enrich-from-reviews/route";

/**
 * Runs all maintenance tasks in order:
 * 1. Creates Contact records for any booking or ReviewRequest email not yet in the DB.
 * 2. Links Review records to their matching Contact by email or phone.
 * 3. Auto-fills missing contact fields from bookings/review requests.
 * Returns conflict entries (differing values) for the admin to resolve.
 * @param prisma - Prisma client instance.
 * @returns Array of conflict entries for admin resolution.
 */
export async function autoMaintain(prisma: PrismaClient): Promise<ConflictEntry[]> {
  await backfillContacts(prisma);
  await matchReviewContacts(prisma);
  return autoEnrich(prisma);
}

/**
 * Creates a Contact for every unique email found in Booking or ReviewRequest records
 * that does not already have a corresponding Contact.
 * Also merges phone-only contacts into their email-based counterpart when both share
 * the same phone number. Existing contacts are never overwritten otherwise —
 * admin edits are the source of truth.
 * @param prisma - Prisma client instance.
 */
async function backfillContacts(prisma: PrismaClient): Promise<void> {
  const [bookings, reviewRequests, allContacts] = await Promise.all([
    prisma.booking.findMany({
      orderBy: { createdAt: "asc" },
      select: { name: true, email: true, phone: true, notes: true },
    }),
    prisma.reviewRequest.findMany({
      orderBy: { createdAt: "asc" },
      select: { name: true, email: true, phone: true },
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
    const norm = normalizePhone(toE164NZ(c.phone) || c.phone);
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
  const existingPhones = new Set(
    existing.filter((c) => c.phone).map((c) => normalizePhone(toE164NZ(c.phone!) || c.phone!)),
  );
  // Remaining phone-only contacts (post-merge) — used to merge-on-create below
  const phoneOnlyByNorm = new Map<string, (typeof existing)[number]>();
  for (const c of existing) {
    if (!c.email && c.phone) {
      const norm = normalizePhone(toE164NZ(c.phone) || c.phone);
      if (norm) phoneOnlyByNorm.set(norm, c);
    }
  }

  const toCreateByEmail = new Map<
    string,
    { name: string; email: string; phone: string | null; address: string | null }
  >();
  const toCreateByPhone = new Map<string, { name: string; email: null; phone: string }>();

  // Bookings sorted asc — most recent overwrites earlier entries in the Map
  for (const b of bookings) {
    const email = b.email.toLowerCase();
    if (existingEmails.has(email)) continue;
    const address = b.notes?.match(/Address:\s*(.+)/i)?.[1]?.trim() ?? null;
    toCreateByEmail.set(email, { name: b.name, email, phone: b.phone ?? null, address });
  }

  // ReviewRequests sorted asc — email-based update existing map, phone-only go in separate map
  for (const rr of reviewRequests) {
    if (rr.email) {
      const email = rr.email.toLowerCase();
      if (existingEmails.has(email)) continue;
      const prev = toCreateByEmail.get(email);
      toCreateByEmail.set(email, {
        name: rr.name,
        email,
        phone: prev?.phone ?? rr.phone ?? null,
        address: prev?.address ?? null,
      });
    } else if (rr.phone) {
      const phone = toE164NZ(rr.phone) || rr.phone;
      const normPhone = normalizePhone(phone);
      if (!normPhone || existingPhones.has(normPhone)) continue;
      if (!toCreateByPhone.has(normPhone)) {
        toCreateByPhone.set(normPhone, { name: rr.name, email: null, phone });
      }
    }
  }

  if (toCreateByEmail.size === 0 && toCreateByPhone.size === 0) return;

  await Promise.all([
    ...[...toCreateByEmail.values()].map(async (d) => {
      // If a phone-only contact already has this phone, merge email into it rather than
      // creating a duplicate contact.
      if (d.phone) {
        const norm = normalizePhone(toE164NZ(d.phone) || d.phone);
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
    ...[...toCreateByPhone.values()].map((d) =>
      prisma.contact
        .findFirst({ where: { phone: d.phone } })
        .then((exists) => (exists ? null : prisma.contact.create({ data: d })))
        .catch(() => null),
    ),
  ]);
}

/**
 * Links Review records that have no contactId to their matching Contact,
 * using the booking or ReviewRequest email as the primary key, with phone as a fallback.
 * @param prisma - Prisma client instance.
 */
async function matchReviewContacts(prisma: PrismaClient): Promise<void> {
  const unlinked = await prisma.review.findMany({
    where: { contactId: null },
    select: { id: true, bookingId: true, customerRef: true },
  });

  if (unlinked.length === 0) return;

  const bookingIds = unlinked.map((r) => r.bookingId).filter((id): id is string => id !== null);

  const [bookingRows, contacts, rrRows] = await Promise.all([
    bookingIds.length > 0
      ? prisma.booking.findMany({
          where: { id: { in: bookingIds } },
          select: { id: true, email: true, phone: true },
        })
      : Promise.resolve([]),
    prisma.contact.findMany({ select: { id: true, email: true, phone: true } }),
    // Include all review requests (email or phone only) for phone-based fallback
    prisma.reviewRequest.findMany({
      select: { reviewToken: true, email: true, phone: true },
    }),
  ]);

  const bookingEmailById = new Map(bookingRows.map((b) => [b.id, b.email.toLowerCase()]));
  const bookingPhoneById = new Map<string, string>();
  for (const b of bookingRows) {
    if (b.phone) {
      const norm = normalizePhone(toE164NZ(b.phone) || b.phone);
      if (norm) bookingPhoneById.set(b.id, norm);
    }
  }

  const contactIdByEmail = new Map(
    contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c.id]),
  );
  const contactIdByPhone = new Map<string, string>();
  for (const c of contacts) {
    if (c.phone) {
      const norm = normalizePhone(toE164NZ(c.phone) || c.phone);
      if (norm && !contactIdByPhone.has(norm)) contactIdByPhone.set(norm, c.id);
    }
  }

  const emailByToken = new Map<string, string>();
  const phoneByToken = new Map<string, string>();
  for (const rr of rrRows) {
    if (rr.email) emailByToken.set(rr.reviewToken, rr.email.toLowerCase());
    if (rr.phone) {
      const norm = normalizePhone(toE164NZ(rr.phone) || rr.phone);
      if (norm) phoneByToken.set(rr.reviewToken, norm);
    }
  }

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
        const email = emailByToken.get(r.customerRef);
        if (email) contactId = contactIdByEmail.get(email);
        if (!contactId) {
          const phone = phoneByToken.get(r.customerRef);
          if (phone) contactId = contactIdByPhone.get(phone);
        }
      }

      if (!contactId) return;
      await prisma.review.update({ where: { id: r.id }, data: { contactId } }).catch(() => null);
    }),
  );
}

/**
 * Auto-fills missing contact fields (phone, address) from the most recent matching
 * ReviewRequest or Booking, matching by email or phone. Returns a list of conflicts
 * where existing contact data differs from the source data.
 * Review requests are checked before bookings; within each source type, newest wins.
 * @param prisma - Prisma client instance.
 * @returns Array of conflicts for admin resolution.
 */
async function autoEnrich(prisma: PrismaClient): Promise<ConflictEntry[]> {
  const [contacts, reviewRequests, bookings] = await Promise.all([
    prisma.contact.findMany({
      select: { id: true, name: true, email: true, phone: true, address: true },
    }),
    prisma.reviewRequest.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, email: true, phone: true },
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
    if (c.phone) {
      const norm = normalizePhone(toE164NZ(c.phone) || c.phone);
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
      const norm = normalizePhone(toE164NZ(phone) || phone);
      if (norm) return contactByPhone.get(norm);
    }
    return undefined;
  }

  const conflicts: ConflictEntry[] = [];
  // Per-contact tracking: newest-matching source wins for conflicts;
  // fills use independent tracking so a booking can fill address even after an RR filled phone.
  const conflictSeen = new Set<string>();
  const phoneFilled = new Set<string>();
  const nameFilled = new Set<string>();
  const addressFilled = new Set<string>();
  const phoneUpdates = new Map<string, string>();
  const nameUpdates = new Map<string, string>();
  const addressUpdates = new Map<string, string>();

  // ReviewRequests — newest first per contact: fill phone, detect conflicts
  for (const rr of reviewRequests) {
    const contact = findContact(rr.email, rr.phone);
    if (!contact) continue;

    const proposedPhoneRaw = rr.phone?.trim() ?? null;
    const proposedPhone = proposedPhoneRaw ? normalizePhone(proposedPhoneRaw) : null;
    const existingPhone = contact.phone ? normalizePhone(contact.phone) : null;

    if (proposedPhone && !existingPhone && !phoneFilled.has(contact.id)) {
      phoneFilled.add(contact.id);
      phoneUpdates.set(contact.id, toE164NZ(proposedPhoneRaw!) || proposedPhoneRaw!);
    }

    // Auto-fill name when contact has only a first name and source provides full name.
    const proposedNameRR = rr.name.trim();
    if (
      proposedNameRR &&
      contact.name &&
      !nameFilled.has(contact.id) &&
      proposedNameRR.toLowerCase().startsWith(contact.name.toLowerCase() + " ")
    ) {
      nameFilled.add(contact.id);
      nameUpdates.set(contact.id, proposedNameRR);
    }

    if (!conflictSeen.has(contact.id)) {
      conflictSeen.add(contact.id);
      const conflictFields: ("name" | "phone")[] = [];
      const proposedName = proposedNameRR;
      const contactNameLower = contact.name.toLowerCase();
      const proposedNameLower = proposedName.toLowerCase();
      // Only flag a name conflict when the proposed name is genuinely different —
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
          source: "ReviewRequest",
          sourceId: rr.id,
          sourceName: conflictFields.includes("name") ? proposedName : null,
          sourcePhone: conflictFields.includes("phone") ? proposedPhoneRaw : null,
          conflictFields,
        });
      }
    }
  }

  // Bookings — newest first per contact: fill phone + address, detect conflicts
  for (const booking of bookings) {
    const contact = findContact(booking.email, booking.phone);
    if (!contact) continue;

    const proposedPhoneRaw = booking.phone?.trim() ?? null;
    const proposedPhone = proposedPhoneRaw ? normalizePhone(proposedPhoneRaw) : null;
    const existingPhone = contact.phone ? normalizePhone(contact.phone) : null;
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
      // Only flag a name conflict when the proposed name is genuinely different —
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

  await Promise.all([
    ...[...phoneUpdates.entries()].map(([id, phone]) =>
      prisma.contact.update({ where: { id }, data: { phone } }),
    ),
    ...[...nameUpdates.entries()].map(([id, name]) =>
      prisma.contact.update({ where: { id }, data: { name } }),
    ),
    ...[...addressUpdates.entries()].map(([id, address]) =>
      prisma.contact.update({ where: { id }, data: { address } }),
    ),
  ]);

  return conflicts;
}
