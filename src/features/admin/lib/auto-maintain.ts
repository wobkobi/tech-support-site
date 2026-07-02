// src/features/admin/lib/auto-maintain.ts
/**
 * @description Server-side maintenance tasks that run on every admin page load.
 * Operations are idempotent and fast when there is nothing to do. The contact
 * dedup/backfill/matching/enrich steps live in {@link module:features/contacts/lib/maintenance}
 * so this page load and the standalone admin routes share one implementation.
 */

import {
  backfillContactsFromBookings,
  type ConflictEntry,
  enrichContactsFromBookings,
  matchReviewsToContacts,
  mergeDuplicateEmailContacts,
  mergePhoneOnlyContacts,
  normaliseSoftDeleteField,
} from "@/features/contacts/lib/maintenance";

/**
 * Runs all maintenance tasks in order:
 * 1. Merges phone-only duplicate contacts, then creates Contacts for any booking email not in the DB.
 * 2. Links Review records to their matching Contact by email or phone.
 * 3. Auto-fills missing contact fields from bookings.
 * Returns booking-sourced conflict entries (differing values) for the admin to resolve.
 * @returns Array of conflict entries for admin resolution.
 */
export async function autoMaintain(): Promise<ConflictEntry[]> {
  // Normalise first: a contact missing the deletedAt field is invisible to
  // every `deletedAt: null` reader below (MongoDB isSet gotcha).
  await normaliseSoftDeleteField();
  await mergeDuplicateEmailContacts();
  await mergePhoneOnlyContacts();
  await backfillContactsFromBookings();
  await matchReviewsToContacts();
  return enrichContactsFromBookings();
}
