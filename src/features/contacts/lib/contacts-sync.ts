// src/features/contacts/lib/contacts-sync.ts
// Two-way Google Contacts sync: local dedup first, push the dirty set, then pull.
// The per-contact merge/conflict engine lives in google-contacts.ts.

import { UNRESOLVED_CONFLICT_FILTER } from "@/features/contacts/lib/contact-conflicts";
import { prisma } from "@/shared/lib/prisma";
import { acquireRunLock, releaseRunLock } from "@/shared/lib/run-lock";
import { importFromGoogleContacts, syncContactToGoogle } from "./google-contacts";
import {
  backfillContactsFromBookings,
  matchReviewsToContacts,
  mergeDuplicateEmailContacts,
  mergeDuplicateGoogleContacts,
  mergePhoneOnlyContacts,
  normaliseSoftDeleteField,
} from "./maintenance";

/** Setting key for the run lock shared by the cron and the manual sync. */
export const CONTACTS_SYNC_LOCK_KEY = "sync-contacts-lock";

/** Outcome counts from a {@link runContactsSync} pass. */
export interface ContactsSyncResult {
  /** True when another run held the lock and this call did nothing. */
  alreadyRunning?: boolean;
  /** Contacts pushed to Google this run. */
  pushed: number;
  /** Contacts pulled/linked from Google this run. */
  imported: number;
  /** Unresolved contact conflicts remaining after the run. */
  conflicts: number;
  /** Contacts skipped because they have an unresolved conflict. */
  skipped: number;
}

/**
 * Runs a two-way contacts sync. Maintenance runs first so no duplicates are pushed;
 * the push covers never-synced or locally changed contacts (all with `full`),
 * skipping conflicted ones. Phone-only contacts are pull-only.
 * @param options - Sync options.
 * @param options.full - Push every email-bearing contact instead of just the dirty set.
 * @returns Counts of pushed, imported, remaining conflicts, and skipped contacts.
 */
export async function runContactsSync({
  full = false,
}: { full?: boolean } = {}): Promise<ContactsSyncResult> {
  // DB lock: overlapping runs race on merges and deletes, across instances.
  if (!(await acquireRunLock(CONTACTS_SYNC_LOCK_KEY))) {
    return { pushed: 0, imported: 0, conflicts: 0, skipped: 0, alreadyRunning: true };
  }

  try {
    // 1. Local clean-up. Normalise deletedAt first (a missing key hides the row from
    // `deletedAt: null` readers), then merge strongest key first: Google id, email, mobile.
    await normaliseSoftDeleteField();
    await mergeDuplicateGoogleContacts();
    await mergeDuplicateEmailContacts();
    await mergePhoneOnlyContacts();
    await backfillContactsFromBookings();
    await matchReviewsToContacts();

    // 2. Build the push set from live, email-bearing contacts.
    const contacts = await prisma.contact.findMany({
      where: { deletedAt: null, email: { not: null } },
      select: { id: true, updatedAt: true, lastSyncedAt: true, googleContactId: true },
    });

    const pendingConflicts = await prisma.contactConflict.findMany({
      where: { ...UNRESOLVED_CONFLICT_FILTER },
      select: { contactId: true },
    });
    const conflictedIds = new Set(pendingConflicts.map((c) => c.contactId));

    const dirty = contacts.filter((c) => {
      // A full sync ignores the conflict skip, else a conflict could never clear; a
      // genuine one is simply re-recorded.
      if (full) return true;
      if (conflictedIds.has(c.id)) return false;
      if (!c.googleContactId) return true;
      if (!c.lastSyncedAt) return true;
      return c.updatedAt.getTime() > c.lastSyncedAt.getTime();
    });

    let pushed = 0;
    for (const c of dirty) {
      try {
        await syncContactToGoogle(c.id);
        pushed++;
      } catch (err) {
        // Guard so one bad contact cannot abort the run.
        console.error(`[contacts-sync] push failed for ${c.id}:`, err);
      }
    }

    // 3. Pull Google's changes back in.
    const imported = await importFromGoogleContacts();

    const conflicts = await prisma.contactConflict.count({
      where: { ...UNRESOLVED_CONFLICT_FILTER },
    });
    return { pushed, imported, conflicts, skipped: conflictedIds.size };
  } finally {
    await releaseRunLock(CONTACTS_SYNC_LOCK_KEY);
  }
}
