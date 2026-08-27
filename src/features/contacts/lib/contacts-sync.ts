// src/features/contacts/lib/contacts-sync.ts
// Orchestrates a two-way Google Contacts sync: local dedup/merge FIRST so duplicates
// never reach Google, then push only the contacts that changed (the dirty set), then pull
// Google's changes back. Decides what to sync and when; the per-contact merge/conflict
// engine lives in google-contacts.ts.

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

/** Outcome counts from a {@link runContactsSync} pass. */
/** Setting key for the run lock shared by the cron and the manual sync. */
export const CONTACTS_SYNC_LOCK_KEY = "sync-contacts-lock";

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
 * Runs a two-way contacts sync.
 *
 * Order matters: local maintenance (phone-only merge, booking backfill, review
 * linking) runs first so the push never sends duplicate rows to Google. The push
 * then targets only the "dirty" set - contacts with no googleContactId (never
 * synced, e.g. those created from bookings), no lastSyncedAt, or a local change
 * since the last sync - unless `full` forces every email-bearing contact. Contacts
 * with an unresolved conflict are skipped so a pending admin decision isn't
 * clobbered. Phone-only contacts (no email) are pull-only, as in the manual flow.
 * @param options - Sync options.
 * @param options.full - Push every email-bearing contact instead of just the dirty set.
 * @returns Counts of pushed, imported, remaining conflicts, and skipped contacts.
 */
export async function runContactsSync({
  full = false,
}: { full?: boolean } = {}): Promise<ContactsSyncResult> {
  // Refuse to overlap: this run merges and hard-deletes duplicates before
  // pushing, so two at once race each other. The cron and a manual click can
  // land on different instances, so the lock lives in the database.
  if (!(await acquireRunLock(CONTACTS_SYNC_LOCK_KEY))) {
    return { pushed: 0, imported: 0, conflicts: 0, skipped: 0, alreadyRunning: true };
  }

  try {
    // 1. Clean up locally so duplicates never reach Google. Normalise deletedAt first - a
    // contact missing the key is invisible to every `deletedAt: null` reader, the merge
    // passes included. Merges then run strongest key first: a shared Google resource name
    // proves a duplicate, a shared email nearly does, a shared mobile is weakest.
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
      // A full sync overrides the conflict skip below, or the two deadlock: a conflicted
      // contact is never pushed, so the comparison that would clear the conflict never
      // runs. Safe, because that comparison still re-records a genuine conflict.
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
        // syncContactToGoogle already swallows its own errors; this guards against
        // anything unexpected so one bad contact can't abort the whole run.
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
