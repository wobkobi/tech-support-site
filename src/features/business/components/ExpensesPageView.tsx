"use client";
// src/features/business/components/ExpensesPageView.tsx
// Pairs ExpensesView with SubscriptionsView; a migrate bumps the `reloadKey` the
// subscriptions view watches, so the new subscription appears at once.

import { ExpensesView } from "@/features/business/components/ExpensesView";
import { SubscriptionsView } from "@/features/business/components/SubscriptionsView";
import type { GstStatus } from "@/features/business/lib/tax/types";
import type React from "react";
import { useState } from "react";

/** Props for {@link ExpensesPageView}. */
interface ExpensesPageViewProps {
  /** GST registration from the pricing settings, for the expenses ledger. */
  gst: GstStatus;
  /** Expenses costing more than this (on the GST basis) offer "Turn into an asset"; settings.tax.lowValueThreshold. */
  assetThreshold: number;
  /** Ids of expenses already linked to an asset. */
  linkedExpenseIds: readonly string[];
}

/**
 * Expenses + subscriptions with migrate-triggered reload wiring.
 * @param props - Component props.
 * @param props.gst - GST registration status for the expenses ledger.
 * @param props.assetThreshold - Cost (on the GST basis) above which an expense offers "Turn into an asset".
 * @param props.linkedExpenseIds - Expenses already linked to an asset.
 * @returns The wrapper element.
 */
export function ExpensesPageView({
  gst,
  assetThreshold,
  linkedExpenseIds,
}: ExpensesPageViewProps): React.ReactElement {
  const [subsReloadKey, setSubsReloadKey] = useState(0);
  return (
    <>
      <ExpensesView
        onMigrated={() => setSubsReloadKey((k) => k + 1)}
        gst={gst}
        assetThreshold={assetThreshold}
        linkedExpenseIds={linkedExpenseIds}
      />
      <div className="mt-6">
        <SubscriptionsView reloadKey={subsReloadKey} />
      </div>
    </>
  );
}
