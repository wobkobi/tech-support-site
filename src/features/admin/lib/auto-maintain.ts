// src/features/admin/lib/auto-maintain.ts
/**
 * @description Server-side maintenance tasks that run on every admin page load.
 * Operations are idempotent and fast when there is nothing to do. The contact
 * dedup/backfill/matching/enrich steps live in {@link module:features/contacts/lib/maintenance}
 * so this page load and the standalone admin routes share one implementation;
 * only the legacy ReviewRequest migration is unique to this entry point.
 */

import {
  backfillContactsFromBookings,
  type ConflictEntry,
  enrichContactsFromBookings,
  matchReviewsToContacts,
  mergePhoneOnlyContacts,
} from "@/features/contacts/lib/maintenance";
import { normaliseContactPhone } from "@/shared/lib/normalise-phone";
import type { PrismaClient } from "@prisma/client";

/**
 * Runs all maintenance tasks in order:
 * 1. Migrates legacy ReviewRequest send state onto Contact (one-shot per row, idempotent).
 * 2. Merges phone-only duplicate contacts, then creates Contacts for any booking email not in the DB.
 * 3. Links Review records to their matching Contact by email or phone.
 * 4. Auto-fills missing contact fields from bookings.
 * Returns booking-sourced conflict entries (differing values) for the admin to resolve.
 * @param prisma - Prisma client instance.
 * @returns Array of conflict entries for admin resolution.
 */
export async function autoMaintain(prisma: PrismaClient): Promise<ConflictEntry[]> {
  // Migration runs first so subsequent steps see the unified Contact state.
  await migrateReviewRequestsToContacts(prisma);
  await mergePhoneOnlyContacts();
  await backfillContactsFromBookings();
  await matchReviewsToContacts();
  return enrichContactsFromBookings();
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
    const norm = normaliseContactPhone(c.phone);
    if (norm) contactByPhone.set(norm, c);
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
        (rr.phone ? contactByPhone.get(normaliseContactPhone(rr.phone) ?? "") : undefined));
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
