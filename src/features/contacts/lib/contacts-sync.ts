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
/** The push stops starting contacts after this long, well inside the 300 s function limit. */
const PUSH_BUDGET_MS = 200_000;

/** Outcome counts from a {@link runContactsSync} pass. */
export interface ContactsSyncResult {
  /** True when another run held the lock and this call did nothing. */
  alreadyRunning?: boolean;
  /** Contacts synced with or created in Google this run. */
  pushed: number;
  /** Contacts whose sync failed; they're tried again next run. */
  failed: number;
  /** True when Google's rate limit stopped the run early. */
  rateLimited: boolean;
  /** Contacts not reached before the run stopped. */
  left: number;
  /** Contacts pulled/linked from Google this run. */
  imported: number;
  /** Unresolved contact conflicts remaining after the run. */
  conflicts: number;
}

/**
 * Runs a two-way contacts sync. Maintenance runs first so no duplicates are pushed;
 * the push covers never-synced or locally changed contacts (all with `full`), longest
 * unsynced first so a run that stops early is carried on by the next. A rate limit ends
 * the run: carrying on would only fail the rest. Phone-only contacts are pull-only.
 * @param options - Sync options.
 * @param options.full - Push every email-bearing contact instead of just the dirty set.
 * @returns Counts of pushed, failed, unreached and imported contacts and remaining conflicts.
 */
export async function runContactsSync({
  full = false,
}: { full?: boolean } = {}): Promise<ContactsSyncResult> {
  // DB lock: overlapping runs race on merges and deletes, across instances.
  if (!(await acquireRunLock(CONTACTS_SYNC_LOCK_KEY))) {
    return {
      pushed: 0,
      failed: 0,
      rateLimited: false,
      left: 0,
      imported: 0,
      conflicts: 0,
      alreadyRunning: true,
    };
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

    // A contact with an open conflict syncs too: the sync holds just the disputed field.
    const dirty = contacts
      .filter((c) => {
        if (full) return true;
        if (!c.googleContactId) return true;
        if (!c.lastSyncedAt) return true;
        return c.updatedAt.getTime() > c.lastSyncedAt.getTime();
      })
      .sort((a, b) => (a.lastSyncedAt?.getTime() ?? 0) - (b.lastSyncedAt?.getTime() ?? 0));

    const deadline = Date.now() + PUSH_BUDGET_MS;
    let pushed = 0;
    let failed = 0;
    let rateLimited = false;
    let reached = 0;
    for (const c of dirty) {
      if (Date.now() > deadline) break;
      reached++;
      const outcome = await syncContactToGoogle(c.id);
      if (outcome === "synced" || outcome === "created") pushed++;
      else if (outcome !== "skipped") failed++;
      if (outcome === "rate-limited") {
        rateLimited = true;
        break;
      }
    }

    // 3. Pull Google's changes back in, unless Google is refusing calls right now.
    const imported = rateLimited ? 0 : await importFromGoogleContacts();

    const conflicts = await prisma.contactConflict.count({
      where: { ...UNRESOLVED_CONFLICT_FILTER },
    });
    return { pushed, failed, rateLimited, left: dirty.length - reached, imported, conflicts };
  } finally {
    await releaseRunLock(CONTACTS_SYNC_LOCK_KEY);
  }
}
