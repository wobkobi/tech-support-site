// src/features/contacts/lib/contacts-sync.ts
// Orchestrates a two-way Google Contacts sync. Runs the local dedup/merge
// maintenance FIRST so duplicates are never propagated up to Google, then pushes
// only the contacts that actually changed (the dirty set), then pulls Google's
// changes back in. Reuses the per-contact merge/conflict engine in
// google-contacts.ts unchanged - this module only decides what to sync and when.

import { prisma } from "@/shared/lib/prisma";
import { importFromGoogleContacts, syncContactToGoogle } from "./google-contacts";
import {
  backfillContactsFromBookings,
  matchReviewsToContacts,
  mergePhoneOnlyContacts,
} from "./maintenance";

/** Outcome counts from a {@link runContactsSync} pass. */
export interface ContactsSyncResult {
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
  // 1. Clean up locally so duplicates never propagate to Google.
  await mergePhoneOnlyContacts();
  await backfillContactsFromBookings();
  await matchReviewsToContacts();

  // 2. Build the push set from live, email-bearing contacts.
  const contacts = await prisma.contact.findMany({
    where: { deletedAt: null, email: { not: null } },
    select: { id: true, updatedAt: true, lastSyncedAt: true, googleContactId: true },
  });

  const pendingConflicts = await prisma.contactConflict.findMany({
    where: { resolvedAt: null },
    select: { contactId: true },
  });
  const conflictedIds = new Set(pendingConflicts.map((c) => c.contactId));

  const dirty = contacts.filter((c) => {
    if (conflictedIds.has(c.id)) return false;
    if (full) return true;
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

  const conflicts = await prisma.contactConflict.count({ where: { resolvedAt: null } });
  return { pushed, imported, conflicts, skipped: conflictedIds.size };
}
