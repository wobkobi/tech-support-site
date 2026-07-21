// src/app/admin/(shell)/business/expenses/page.tsx
/**
 * @description Admin expenses page. Renders {@link ExpensesPageView}, which pairs
 * the expenses ledger with the subscriptions list below and refreshes the latter
 * when an expense is migrated into a subscription.
 */
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { ExpensesPageView } from "@/features/business/components/ExpensesPageView";
import { requireAdminAuth } from "@/shared/lib/auth";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Expenses - Business",
  robots: { index: false, follow: false },
};

/**
 * Admin expenses page for recording and viewing expense entries.
 * @returns Expenses page element
 */
export default async function ExpensesPage(): Promise<React.ReactElement> {
  await requireAdminAuth();

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Record expenses and recurring subscriptions; migrate a repeat cost into a subscription."
      />
      <ExpensesPageView />
    </>
  );
}
