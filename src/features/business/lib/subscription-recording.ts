// src/features/business/lib/subscription-recording.ts
/**
 * @description Shared subscription-payment writer used by both the cron sweep
 * and the admin "Record payment" button, so the two cannot disagree about which
 * day a payment lands on or whether a double-fire is safe.
 */

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

/**
 * Records one subscription payment: claims the period, writes the expense, and
 * advances nextDue.
 *
 * The claim is a compare-and-set on nextDue, so a cron run racing the admin
 * button - or a double-clicked button - writes the expense exactly once. The
 * expense is dated UTC midnight of the NZ calendar day, matching how the rest
 * of the ledger stores dates; the raw clock would land a day early when the
 * cron fires at 8am NZ and UTC is still on the previous date.
 * @param sub - The subscription being recorded.
 * @param on - Overrides the payment date; defaults to today in NZ.
 * @returns Whether the period was claimed, the expense, the new nextDue, and a sync-warning flag.
 */
export async function recordSubscriptionPayment(
  sub: Subscription,
  on?: Date,
): Promise<RecordSubscriptionResult> {
  const date = on ?? new Date(`${nzTodayKey()}T00:00:00.000Z`);
  const nextDue = advanceNextDue(sub.nextDue, sub.frequency);

  // Claim the period before writing anything. A post-claim failure leaves the
  // operator to re-record by hand, which is safer than risking a duplicate row.
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
    amountIncl: sub.amountIncl,
    gstRate: sub.gstRate,
    method: sub.method,
    notes: sub.notes,
  });

  return { claimed: true, expense: entry, nextDue, sheetSyncWarning };
}
