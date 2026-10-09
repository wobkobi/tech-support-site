// src/features/business/components/expenses-recurrence.ts
// Recurrence detection for the expenses ledger: expenses sharing a normalised supplier +
// description are one repeat cost, which can migrate to a subscription once it has
// repeated often enough. Shared by ExpensesView and its row components.

import type { ExpenseEntry } from "@/features/business/types/business";

// An expense can only migrate to a subscription once its supplier+description has
// repeated MORE THAN twice - one coincidental pair isn't a confirmed pattern.
export const MIGRATE_MIN_MATCHES = 3;

/**
 * Recurrence key: normalised supplier + description. Expenses sharing a key are
 * the same repeat cost (a likely subscription), and an active subscription with
 * the key means that cost has already been migrated.
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
