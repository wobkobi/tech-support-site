// src/features/contacts/lib/find-or-create.ts
/**
 * @description Shared find-or-create helpers for Contact records. Centralises
 * the pattern used by booking, review-request and admin flows that need to
 * land a Contact row when one doesn't already exist for an email or phone.
 *
 * Email is not `@unique` in the schema (see model Contact in schema.prisma)
 * so prisma.contact.upsert cannot be used directly - the find + conditional
 * create pattern below is the canonical replacement.
 */

import { normaliseContactPhone } from "@/shared/lib/normalise-phone";
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
  googleContactId?: string | null;
}

export interface FindOrCreateResult {
  contact: Contact;
  created: boolean;
}

/**
 * Finds a Contact by email, creating one with `seed` if none exists. Matching is
 * case-insensitive and the email is stored lowercased, so callers can't create a
 * duplicate just by varying case. Soft-deleted contacts are ignored (a fresh row
 * is created). The email passed in is written to the created row, overriding any
 * email present on `seed`.
 * @param email - Email to match on (normalised internally).
 * @param seed - Fields used if a new row is created.
 * @returns The contact and whether it was newly created.
 */
export async function findOrCreateContactByEmail(
  email: string,
  seed: ContactSeed,
): Promise<FindOrCreateResult> {
  const normalisedEmail = email.trim().toLowerCase();
  const existing = await prisma.contact.findFirst({
    where: { email: { equals: normalisedEmail, mode: "insensitive" }, deletedAt: null },
  });
  if (existing) return { contact: existing, created: false };
  const contact = await prisma.contact.create({
    data: {
      name: seed.name,
      email: normalisedEmail,
      phone: seed.phone ?? null,
      address: seed.address ?? null,
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
    where: { phone: normalisedPhone, deletedAt: null },
  });
  if (existing) return { contact: existing, created: false };
  const contact = await prisma.contact.create({
    data: {
      name: seed.name,
      email: seed.email ?? null,
      phone: normalisedPhone,
      address: seed.address ?? null,
      googleContactId: seed.googleContactId ?? null,
    },
  });
  return { contact, created: true };
}
