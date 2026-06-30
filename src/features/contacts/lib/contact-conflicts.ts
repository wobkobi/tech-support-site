// src/features/contacts/lib/contact-conflicts.ts
/**
 * @description Helpers for recording and resolving sync conflicts between the
 * site DB and Google Contacts. A conflict is created when a single-value field
 * (name, email, address) has different values on each side AND both sides
 * have changed since the last successful sync, so auto-resolution isn't safe.
 */

import { prisma } from "@/shared/lib/prisma";
import type { ConflictResolution, ContactField } from "@prisma/client";

// Re-export the Prisma enum types under the names the rest of the codebase
// uses. The admin-driven resolution endpoint also accepts "auto" via the
// ConflictResolution enum; that variant is stamped by clearContactConflict
// rather than picked by a human, so the public TS type below excludes it.
export type { ContactField };
export type AdminConflictResolution = Exclude<ConflictResolution, "auto">;

/**
 * Records (or refreshes) a pending conflict for a contact's field. If an
 * unresolved row already exists for the same contactId + field, its values
 * are updated in place so the admin always sees the latest both-sides state.
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
      where: { contactId, field, resolvedAt: null },
      select: { id: true },
    });
    if (existing) {
      await prisma.contactConflict.update({
        where: { id: existing.id },
        data: { siteValue, googleValue },
      });
    } else {
      await prisma.contactConflict.create({
        data: { contactId, field, siteValue, googleValue },
      });
    }
  } catch (err) {
    // Conflict recording must never block the sync flow.
    console.error("[contact-conflicts] recordContactConflict failed:", err);
  }
}

/**
 * Clears any pending conflict for this contact + field. Called when the field
 * resolves itself (values now match) so the admin's conflict list doesn't
 * show stale entries.
 * @param contactId - Local Contact id.
 * @param field - Which field is no longer in conflict.
 * @returns Promise that resolves when any pending row is marked resolved.
 */
export async function clearContactConflict(contactId: string, field: ContactField): Promise<void> {
  try {
    await prisma.contactConflict.updateMany({
      where: { contactId, field, resolvedAt: null },
      data: { resolvedAt: new Date(), resolution: "auto" },
    });
  } catch (err) {
    console.error("[contact-conflicts] clearContactConflict failed:", err);
  }
}
