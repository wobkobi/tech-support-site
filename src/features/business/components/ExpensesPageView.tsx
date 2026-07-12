"use client";
// src/features/business/components/ExpensesPageView.tsx
/**
 * @description Thin client wrapper pairing {@link ExpensesView} with
 * {@link SubscriptionsView} on the expenses page. They are sibling components
 * with separate self-loaded state, so a migrate in the expenses view can't
 * directly refresh the subscriptions list - this wrapper bumps a `reloadKey`
 * the subscriptions view watches, so a migrated subscription appears at once.
 */

import { ExpensesView } from "@/features/business/components/ExpensesView";
import { SubscriptionsView } from "@/features/business/components/SubscriptionsView";
import type React from "react";
import { useState } from "react";

/**
 * Expenses + subscriptions with migrate-triggered reload wiring.
 * @returns The wrapper element.
 */
export function ExpensesPageView(): React.ReactElement {
  const [subsReloadKey, setSubsReloadKey] = useState(0);
  return (
    <>
      <ExpensesView onMigrated={() => setSubsReloadKey((k) => k + 1)} />
      <div className="mt-10">
        <SubscriptionsView reloadKey={subsReloadKey} />
      </div>
    </>
  );
}
