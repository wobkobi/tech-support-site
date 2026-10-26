// src/features/contacts/lib/contact-conflicts.ts
// Records and resolves site-vs-Google Contacts conflicts: a single-value field that
// differs AND changed on both sides since the last sync.

import { prisma } from "@/shared/lib/prisma";
import type { ContactField } from "@prisma/client";

// Re-export the Prisma enum type under the name the rest of the codebase uses.
export type { ContactField };

/**
 * Where-fragment for unresolved conflicts. Must be this OR shape: rows have no
 * `resolvedAt` key, and a bare `resolvedAt: null` means "exists AND is null" in
 * Prisma/Mongo. Spread into a `where` with no OR of its own (else wrap in AND).
 */
export const UNRESOLVED_CONFLICT_FILTER = {
  // Plain mutable shape (no `as const`): Prisma's where input needs a mutable OR.
  OR: [{ resolvedAt: null }, { resolvedAt: { isSet: false } }],
};

/**
 * Records a pending conflict for a contact's field, updating an existing
 * unresolved row in place.
 * @param args - Conflict inputs.
 * @param args.contactId - Local Contact id.
 * @param args.field - Which field is in conflict.
 * @param args.siteValue - Site's current value (may be null).
 * @param args.googleValue - Google's current value (may be null).
 * @returns Promise that resolves when the conflict row is persisted.
 */
export async function recordContactConflict(args: {
  contactId: string;
  field: ContactField;
  siteValue: string | null;
  googleValue: string | null;
}): Promise<void> {
  const { contactId, field, siteValue, googleValue } = args;

  try {
    const existing = await prisma.contactConflict.findFirst({
      where: { contactId, field, ...UNRESOLVED_CONFLICT_FILTER },
      select: { id: true },
    });
    if (existing) {
      await prisma.contactConflict.update({
        where: { id: existing.id },
        data: { siteValue, googleValue },
      });
    } else {
      await prisma.contactConflict.create({
        data: { contactId, field, siteValue, googleValue, resolvedAt: null },
      });
    }
  } catch (err) {
    // Conflict recording must never block the sync flow.
    console.error("[contact-conflicts] recordContactConflict failed:", err);
  }
}

/**
 * Clears any pending conflict for this contact + field once the values match.
 * @param contactId - Local Contact id.
 * @param field - Which field is no longer in conflict.
 * @returns Promise that resolves when any pending row is marked resolved.
 */
export async function clearContactConflict(contactId: string, field: ContactField): Promise<void> {
  try {
    await prisma.contactConflict.updateMany({
      where: { contactId, field, ...UNRESOLVED_CONFLICT_FILTER },
      data: { resolvedAt: new Date() },
    });
  } catch (err) {
    console.error("[contact-conflicts] clearContactConflict failed:", err);
  }
}
