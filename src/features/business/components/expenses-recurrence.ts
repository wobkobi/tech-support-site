// src/features/business/components/expenses-recurrence.ts
// Recurrence detection for the expenses ledger: a steady amount from one supplier on a
// steady schedule marks a repeat cost that can migrate to a subscription.

import type { ExpenseEntry } from "@/features/business/types/business";

// Migrate needs MORE THAN two charges in a row; one pair could be coincidence.
export const MIGRATE_MIN_MATCHES = 3;

// Per-use spending that repeats without being a subscription, however regular it looks.
const NEVER_RECURRING_CATEGORIES = new Set(["Fuel", "Parts for clients", "Travel"]);

// Overseas charges converted at the day's rate drift a little month to month.
const AMOUNT_TOLERANCE = 0.05;

// Gap bands in days. Monthly spans 28-day Februaries and a charge landing a few days late.
const CADENCE_BANDS: { min: number; max: number }[] = [
  { min: 6, max: 8 },
  { min: 13, max: 15 },
  { min: 26, max: 35 },
  { min: 84, max: 98 },
  { min: 355, max: 375 },
];

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
 * Which cadence band a gap falls in.
 * @param days - Days between two charges.
 * @returns The band index, or -1 for an irregular gap.
 */
function bandOf(days: number): number {
  return CADENCE_BANDS.findIndex((b) => days >= b.min && days <= b.max);
}

/**
 * Splits date-sorted charges into runs where every gap sits in the same cadence band. A
 * gap in a different valid band starts a new run from the previous charge, so a weekly
 * pair followed by monthly charges still yields the monthly run.
 * @param sorted - Charges of one amount, oldest first.
 * @returns Every run, including singletons.
 */
function splitRuns(sorted: ExpenseEntry[]): ExpenseEntry[][] {
  const runs: ExpenseEntry[][] = [];
  let run: ExpenseEntry[] = [];
  let runBand = -1;
  for (const e of sorted) {
    const prev = run[run.length - 1];
    if (!prev) {
      run = [e];
      continue;
    }
    const band = bandOf((Date.parse(e.date) - Date.parse(prev.date)) / 86_400_000);
    if (band !== -1 && (run.length === 1 || band === runBand)) {
      run.push(e);
      runBand = band;
    } else {
      runs.push(run);
      run = band === -1 ? [e] : [prev, e];
      runBand = band;
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

/**
 * Finds subscription-like repeats: within one supplier+description, at least
 * {@link MIGRATE_MIN_MATCHES} charges within {@link AMOUNT_TOLERANCE} of each other on an
 * unbroken weekly-to-annual schedule. Amounts cluster greedily from the cheapest, so a
 * price change splits into two clusters judged separately.
 * @param entries - The whole ledger.
 * @returns Entry id > its run (oldest first), for recurring entries only.
 */
export function findRecurring(entries: ExpenseEntry[]): Map<string, ExpenseEntry[]> {
  const groups = new Map<string, ExpenseEntry[]>();
  for (const e of entries) {
    if (NEVER_RECURRING_CATEGORIES.has(e.category)) continue;
    const k = groupKey(e);
    const arr = groups.get(k);
    if (arr) arr.push(e);
    else groups.set(k, [e]);
  }

  const result = new Map<string, ExpenseEntry[]>();
  for (const group of groups.values()) {
    if (group.length < MIGRATE_MIN_MATCHES) continue;
    const byAmount = [...group].sort((a, b) => a.amountIncl - b.amountIncl);
    const clusters: ExpenseEntry[][] = [];
    for (const e of byAmount) {
      const cluster = clusters[clusters.length - 1];
      if (cluster && e.amountIncl <= cluster[0]!.amountIncl * (1 + AMOUNT_TOLERANCE)) {
        cluster.push(e);
      } else {
        clusters.push([e]);
      }
    }
    for (const cluster of clusters) {
      const sorted = cluster.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
      for (const run of splitRuns(sorted)) {
        if (run.length < MIGRATE_MIN_MATCHES) continue;
        for (const e of run) result.set(e.id, run);
      }
    }
  }
  return result;
}

/**
 * How many charges are in this expense's recurring run.
 * @param runs - Output of {@link findRecurring}.
 * @param e - The expense.
 * @returns The run length (1 when it isn't recurring).
 */
export function matchCount(runs: Map<string, ExpenseEntry[]>, e: ExpenseEntry): number {
  return runs.get(e.id)?.length ?? 1;
}
