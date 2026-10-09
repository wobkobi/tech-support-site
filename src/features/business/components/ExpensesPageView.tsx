"use client";
// src/features/business/components/ExpensesPageView.tsx
// Thin client wrapper pairing ExpensesView with SubscriptionsView on the expenses page.
// They are sibling components with separate self-loaded state, so a migrate in the
// expenses view can't directly refresh the subscriptions list - this wrapper bumps a
// `reloadKey` the subscriptions view watches, so a migrated subscription appears at once.

import { ExpensesView } from "@/features/business/components/ExpensesView";
import { SubscriptionsView } from "@/features/business/components/SubscriptionsView";
import type { GstStatus } from "@/features/business/lib/tax/types";
import type React from "react";
import { useState } from "react";

/** Props for {@link ExpensesPageView}. */
interface ExpensesPageViewProps {
  /** GST registration from the pricing settings, for the expenses ledger. */
  gst: GstStatus;
}

/**
 * Expenses + subscriptions with migrate-triggered reload wiring.
 * @param props - Component props.
 * @param props.gst - GST registration status for the expenses ledger.
 * @returns The wrapper element.
 */
export function ExpensesPageView({ gst }: ExpensesPageViewProps): React.ReactElement {
  const [subsReloadKey, setSubsReloadKey] = useState(0);
  return (
    <>
      <ExpensesView onMigrated={() => setSubsReloadKey((k) => k + 1)} gst={gst} />
      <div className="mt-10">
        <SubscriptionsView reloadKey={subsReloadKey} />
      </div>
    </>
  );
}
