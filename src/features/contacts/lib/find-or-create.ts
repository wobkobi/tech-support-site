// src/features/contacts/lib/find-or-create.ts
// Shared find-or-create helpers for Contact records. Centralises the pattern used by
// booking, review-request and admin flows that need to land a Contact row when one
// doesn't already exist for an email or phone. An email miss falls back to the Google
// link, then an NZ mobile, attaching the email to that contact rather than duplicating it.
//
// Email is not `@unique` in the schema (see model Contact in schema.prisma) so
// prisma.contact.upsert cannot be used directly - the find + conditional create pattern
// below is the canonical replacement.

import { normaliseEmail } from "@/shared/lib/normalise-email";
import { isNZMobileKey, normaliseContactPhone } from "@/shared/lib/normalise-phone";
import { prisma } from "@/shared/lib/prisma";
import type { Contact } from "@prisma/client";

/**
 * Fields used when creating a Contact. The helpers normalise the match key
 * themselves, so callers may pass raw or pre-normalised values.
 */
export interface ContactSeed {
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  /** True when `address` could not be confidently geocoded and needs review. */
  addressUnverified?: boolean;
  /** Auckland candidates offered to the operator; empty when nothing matched. */
  addressCandidates?: string[];
  googleContactId?: string | null;
}

export interface FindOrCreateResult {
  contact: Contact;
  created: boolean;
  /** True when the email was added to an existing contact matched by Google link or mobile. */
  emailAttached?: boolean;
}

/**
 * Finds a Contact by email, creating one with `seed` if none exists. Matching is
 * case-insensitive and the email is stored lowercased, so callers can't create a
 * duplicate just by varying case. Soft-deleted contacts are ignored (a fresh row
 * is created). The email passed in is written to the created row, overriding any
 * email present on `seed`.
 *
 * When no row has the email but `seed.googleContactId` matches a live contact,
 * the email is attached to that contact instead of creating a duplicate: it
 * becomes the primary email when the contact has none, otherwise an alt email.
 * This is the "Wendy is in contacts, just not her email" case - a contact picked
 * from Google that was saved without one.
 *
 * Failing that, a `seed.phone` that is an NZ mobile matching a live contact with
 * NO email gets the email set on that contact - the same rule the sync's
 * phone-only merge applies later, just before a duplicate exists. Landlines never
 * match (households share them), and a mobile on a contact that already has a
 * different email is left alone, since that is not proof it's the same person.
 * @param email - Email to match on (normalised internally).
 * @param seed - Fields used if a new row is created.
 * @returns The contact, whether it was newly created, and whether the email was attached.
 */
export async function findOrCreateContactByEmail(
  email: string,
  seed: ContactSeed,
): Promise<FindOrCreateResult> {
  const normalisedEmail = normaliseEmail(email);
  const existing = await prisma.contact.findFirst({
    where: {
      OR: [
        { email: { equals: normalisedEmail, mode: "insensitive" } },
        { altEmails: { has: normalisedEmail } },
      ],
      deletedAt: null,
    },
  });
  if (existing) return { contact: existing, created: false };
  const googleContactId = seed.googleContactId?.trim();
  if (googleContactId) {
    const linked = await prisma.contact.findFirst({
      where: { googleContactId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    if (linked) {
      const contact = await prisma.contact.update({
        where: { id: linked.id },
        data: linked.email ? { altEmails: { push: normalisedEmail } } : { email: normalisedEmail },
      });
      return { contact, created: false, emailAttached: true };
    }
  }
  const phoneKey = normaliseContactPhone(seed.phone);
  if (phoneKey && isNZMobileKey(phoneKey)) {
    // Stored phones are E.164, but a few older rows kept the local "021..." form.
    const forms = phoneKey.startsWith("+64") ? [phoneKey, `0${phoneKey.slice(3)}`] : [phoneKey];
    const phoneMatches = await prisma.contact.findMany({
      where: {
        OR: [{ phone: { in: forms } }, { altPhones: { hasSome: forms } }],
        deletedAt: null,
      },
      orderBy: { createdAt: "asc" },
    });
    // Emptiness is checked in JS: Mongo stores no key for an unset email, and
    // `email: null` would not match an absent key.
    const phoneOnly = phoneMatches.find((c) => !c.email?.trim());
    if (phoneOnly) {
      const contact = await prisma.contact.update({
        where: { id: phoneOnly.id },
        data: { email: normalisedEmail },
      });
      return { contact, created: false, emailAttached: true };
    }
  }
  const contact = await prisma.contact.create({
    data: {
      name: seed.name,
      email: normalisedEmail,
      phone: seed.phone ?? null,
      address: seed.address ?? null,
      addressUnverified: seed.addressUnverified ?? false,
      addressCandidates: seed.addressCandidates ?? [],
      // Explicit null, not omitted: Mongo stores no key for an omitted optional field, and
      // `where: { deletedAt: null }` - the filter every reader uses - won't match an absent
      // key. Omit it and the new contact is invisible to the list, sync and matchers.
      deletedAt: null,
      googleContactId: seed.googleContactId ?? null,
    },
  });
  return { contact, created: true };
}

/**
 * Finds a Contact by phone, creating one with `seed` if none exists. The phone
 * is normalised to its canonical E.164 key for matching and storage, so callers
 * can pass raw input. Soft-deleted contacts are ignored. The phone passed in is
 * written to the created row, overriding any phone present on `seed`.
 * @param phone - Phone number to match on (normalised internally).
 * @param seed - Fields used if a new row is created.
 * @returns The contact and whether it was newly created.
 */
export async function findOrCreateContactByPhone(
  phone: string,
  seed: ContactSeed,
): Promise<FindOrCreateResult> {
  const normalisedPhone = normaliseContactPhone(phone) ?? phone;
  const existing = await prisma.contact.findFirst({
    where: {
      OR: [{ phone: normalisedPhone }, { altPhones: { has: normalisedPhone } }],
      deletedAt: null,
    },
  });
  if (existing) return { contact: existing, created: false };
  const contact = await prisma.contact.create({
    data: {
      name: seed.name,
      email: seed.email ?? null,
      phone: normalisedPhone,
      address: seed.address ?? null,
      addressUnverified: seed.addressUnverified ?? false,
      addressCandidates: seed.addressCandidates ?? [],
      // Explicit null - see the note in findOrCreateContactByEmail.
      deletedAt: null,
      googleContactId: seed.googleContactId ?? null,
    },
  });
  return { contact, created: true };
}
