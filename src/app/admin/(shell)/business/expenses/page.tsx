// src/app/admin/(shell)/business/expenses/page.tsx
// Admin expenses page: expenses ledger plus subscriptions, with GST status, the write-off
// threshold and asset links for the "Turn into an asset" action.

import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { ExpensesPageView } from "@/features/business/components/ExpensesPageView";
import { loadGstStatus } from "@/features/business/lib/tax/load";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
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
  const [gst, settings, assets] = await Promise.all([
    loadGstStatus(),
    getSettings(),
    prisma.asset.findMany({ select: { expenseId: true } }),
  ]);
  const linkedExpenseIds = assets.flatMap((a) => (a.expenseId ? [a.expenseId] : []));

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Record expenses and recurring subscriptions; migrate a repeat cost into a subscription."
      />
      <ExpensesPageView
        gst={gst}
        assetThreshold={settings.tax.lowValueThreshold}
        linkedExpenseIds={linkedExpenseIds}
      />
    </>
  );
}
