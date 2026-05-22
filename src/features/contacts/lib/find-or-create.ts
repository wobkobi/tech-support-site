// src/features/contacts/lib/find-or-create.ts
/**
 * @file find-or-create.ts
 * @description Shared find-or-create helpers for Contact records. Centralises
 * the pattern used by booking, review-request and admin flows that need to
 * land a Contact row when one doesn't already exist for an email or phone.
 *
 * Email is not `@unique` in the schema (see model Contact in schema.prisma)
 * so we cannot use prisma.contact.upsert directly - the find + conditional
 * create pattern below is the canonical replacement.
 */

import type { Contact } from "@prisma/client";
import { prisma } from "@/shared/lib/prisma";

/**
 * Fields used when creating a Contact. Caller is responsible for any
 * normalisation (trim, lowercase email, E.164 phone) before passing in.
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
 * Finds a Contact by email, creating one with `seed` if none exists. The
 * email passed in is also written to the created row, overriding any email
 * present on `seed`.
 * @param email - Normalised (trimmed, lowercased) email to match on.
 * @param seed - Fields used if a new row is created.
 * @returns The contact and whether it was newly created.
 */
export async function findOrCreateContactByEmail(
  email: string,
  seed: ContactSeed,
): Promise<FindOrCreateResult> {
  const existing = await prisma.contact.findFirst({ where: { email } });
  if (existing) return { contact: existing, created: false };
  const contact = await prisma.contact.create({
    data: {
      name: seed.name,
      email,
      phone: seed.phone ?? null,
      address: seed.address ?? null,
      googleContactId: seed.googleContactId ?? null,
    },
  });
  return { contact, created: true };
}

/**
 * Finds a Contact by phone, creating one with `seed` if none exists. The
 * phone passed in is also written to the created row, overriding any phone
 * present on `seed`.
 * @param phone - Normalised (E.164) phone number to match on.
 * @param seed - Fields used if a new row is created.
 * @returns The contact and whether it was newly created.
 */
export async function findOrCreateContactByPhone(
  phone: string,
  seed: ContactSeed,
): Promise<FindOrCreateResult> {
  const existing = await prisma.contact.findFirst({ where: { phone } });
  if (existing) return { contact: existing, created: false };
  const contact = await prisma.contact.create({
    data: {
      name: seed.name,
      email: seed.email ?? null,
      phone,
      address: seed.address ?? null,
      googleContactId: seed.googleContactId ?? null,
    },
  });
  return { contact, created: true };
}
