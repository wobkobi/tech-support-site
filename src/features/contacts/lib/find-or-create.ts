// src/features/contacts/lib/find-or-create.ts
// Find-or-create helpers for Contact rows by email or phone.
// Email is not `@unique`, so prisma.contact.upsert can't be used; find + conditional create replaces it.

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
  /** Business the person invoices under; stored only when a row is created. */
  company?: string | null;
}

export interface FindOrCreateResult {
  contact: Contact;
  created: boolean;
  /** True when the email was added to an existing contact matched by Google link or mobile. */
  emailAttached?: boolean;
}

/**
 * Finds a live Contact by email (case-insensitive), creating one with `seed` if none exists.
 * On a miss, attach the email to the contact matching `seed.googleContactId`, then to a
 * no-email contact matching an NZ mobile (landlines are shared by households, so never match).
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
      company: seed.company?.trim() || null,
      // Explicit null: `where: { deletedAt: null }` won't match an absent Mongo key.
      deletedAt: null,
      googleContactId: seed.googleContactId ?? null,
    },
  });
  return { contact, created: true };
}

/**
 * Finds a live Contact by phone (normalised to E.164), creating one with `seed` if none exists.
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
      company: seed.company?.trim() || null,
      // Explicit null - see the note in findOrCreateContactByEmail.
      deletedAt: null,
      googleContactId: seed.googleContactId ?? null,
    },
  });
  return { contact, created: true };
}
