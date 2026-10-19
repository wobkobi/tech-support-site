// src/features/business/components/expenses-recurrence.ts
// Recurrence detection for the expenses ledger: a shared normalised supplier + description
// marks a repeat cost that can migrate to a subscription.

import type { ExpenseEntry } from "@/features/business/types/business";

// Migrate needs MORE THAN two matches; one pair could be coincidence.
export const MIGRATE_MIN_MATCHES = 3;

/**
 * Recurrence key: normalised supplier + description, shared by repeats of one cost
 * and by the subscription it migrated to.
 * @param e - The expense or subscription.
 * @param e.supplier - Who is paid.
 * @param e.description - What the payment is for.
 * @returns The group key.
 */
export function groupKey(e: { supplier: string; description: string }): string {
  return `${e.supplier.trim().toLowerCase()}||${e.description.trim().toLowerCase()}`;
}

/**
 * How many expenses share this one's supplier+description; {@link MIGRATE_MIN_MATCHES}
 * or more marks it recurring and offers Migrate.
 * @param groups - The precomputed group map.
 * @param e - The expense.
 * @returns The match count (1 when unique).
 */
export function matchCount(groups: Map<string, ExpenseEntry[]>, e: ExpenseEntry): number {
  return groups.get(groupKey(e))?.length ?? 1;
}
