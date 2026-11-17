// src/features/business/lib/subscription-recording.ts
// Subscription-payment writer behind the admin Record button. Nothing records on its own:
// the daily cron only reminds, since the charged amount can differ from the saved one.

import { advanceNextDue } from "@/features/business/lib/business";
import { recordExpense } from "@/features/business/lib/expense-recording";
import { prisma } from "@/shared/lib/prisma";
import { nzTodayKey } from "@/shared/lib/timezone-utils";
import type { ExpenseEntry, Subscription } from "@prisma/client";

/** Result of {@link recordSubscriptionPayment}. */
export interface RecordSubscriptionResult {
  /** False when the nextDue compare-and-set lost a race; nothing was written. */
  claimed: boolean;
  /** The expense created, or null when the claim was lost. */
  expense: ExpenseEntry | null;
  /** The subscription's nextDue after this call (unchanged when unclaimed). */
  nextDue: Date;
  /** True when the expense was recorded but its sheet mirror was skipped or failed. */
  sheetSyncWarning: boolean;
}

/** What was actually charged, when it differs from the subscription's saved values. */
export interface RecordSubscriptionOverrides {
  /** Payment date; defaults to today in NZ. */
  on?: Date;
  /** GST-inclusive amount charged; defaults to the subscription's amount. */
  amountIncl?: number;
}

/**
 * Records one payment via a compare-and-set claim on nextDue, so racing calls write once.
 * Dated UTC midnight of the NZ day; the raw clock would land a day early at 8am NZ.
 * @param sub - The subscription being recorded.
 * @param overrides - The charged date and amount, when they differ from the saved ones.
 * @returns Whether the period was claimed, the expense, the new nextDue, and a sync-warning flag.
 */
export async function recordSubscriptionPayment(
  sub: Subscription,
  overrides: RecordSubscriptionOverrides = {},
): Promise<RecordSubscriptionResult> {
  const date = overrides.on ?? new Date(`${nzTodayKey()}T00:00:00.000Z`);
  const nextDue = advanceNextDue(sub.nextDue, sub.frequency, sub.dueDay);

  // Claim first: a post-claim failure means a manual re-record, safer than a duplicate.
  const claim = await prisma.subscription.updateMany({
    where: { id: sub.id, nextDue: sub.nextDue },
    data: { nextDue },
  });
  if (claim.count === 0) {
    return { claimed: false, expense: null, nextDue: sub.nextDue, sheetSyncWarning: false };
  }

  const { entry, sheetSyncWarning } = await recordExpense({
    date,
    supplier: sub.supplier,
    description: sub.description,
    category: sub.category,
    amountIncl: overrides.amountIncl ?? sub.amountIncl,
    gstRate: sub.gstRate,
    method: sub.method,
    notes: sub.notes,
  });

  return { claimed: true, expense: entry, nextDue, sheetSyncWarning };
}
