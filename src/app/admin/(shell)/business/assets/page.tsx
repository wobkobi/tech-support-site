// src/app/admin/(shell)/business/assets/page.tsx
// Asset register page. Loads the current FY's tax inputs (assets, expenses, GST status,
// filed closing values, the write-off threshold) through the same loader as the Tax page,
// works out every asset's depreciation schedule and hands plain data to AssetsView.
// `?fromExpense=<id>` opens the asset already linked to that expense, or a new asset
// filled in from it.

import { EmptyState } from "@/features/admin/components/ui/EmptyState";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { AssetsView } from "@/features/business/components/assets/AssetsView";
import {
  assetPrefillFromExpense,
  assetSchedules,
  expenseOptions,
  toAssetView,
  type AssetPrefill,
} from "@/features/business/lib/assets";
import { toTaxFy } from "@/features/business/lib/tax";
import { loadAllFys, loadTaxInputs } from "@/features/business/lib/tax/load";
import { loadFiledYears } from "@/features/business/lib/tax/view.server";
import { requireAdminAuth } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Assets - Business",
  robots: { index: false, follow: false },
};

/**
 * Admin asset register.
 * @param root0 - Page props.
 * @param root0.searchParams - URL search params (`?fromExpense=` opens the form for that expense).
 * @returns Assets page element.
 */
export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ fromExpense?: string | string[] }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth("/admin/business/assets");
  const { fromExpense } = await searchParams;
  const fromExpenseId = typeof fromExpense === "string" ? fromExpense : null;

  const now = new Date();
  const fys = await loadAllFys(now);
  const current = fys.find((f) => f.current) ?? fys[0];
  const header = (
    <PageHeader
      title="Assets"
      description="Gear the business uses for more than a year. Each item is depreciated here instead of counted as a one-off expense."
    />
  );
  if (!current) {
    return (
      <>
        {header}
        <EmptyState
          title="No financial years yet"
          body="Set the business start date in Settings and the asset register shows here."
        />
      </>
    );
  }

  const [input, rows, filedYears] = await Promise.all([
    loadTaxInputs(current, now),
    prisma.asset.findMany({ orderBy: { inServiceDate: "desc" } }),
    loadFiledYears(now),
  ]);

  // Schedules run oldest FY first, whatever order the loader lists them in.
  const taxFys = [...fys].sort((a, b) => a.start.getTime() - b.start.getTime()).map(toTaxFy);
  const schedules = assetSchedules(input.assets, taxFys, {
    businessStart: input.businessStart,
    lowValueThreshold: input.settings.lowValueThreshold,
    filed: input.filedClosingAtv,
  });
  const currentFyKey = toTaxFy(current).key;
  const options = expenseOptions(input.expenses, rows);
  const labels = new Map(options.map((o) => [o.id, o.label]));
  const assets = rows.map((r) => toAssetView(r, schedules.get(r.id) ?? [], currentFyKey, labels));

  // ?fromExpense: an expense that already backs an asset opens that asset; otherwise a
  // new asset is filled in from the expense on its GST basis.
  let prefill: AssetPrefill | null = null;
  let initialEditId: string | null = null;
  let fromExpenseMissing = false;
  if (fromExpenseId) {
    const linked = rows.find((r) => r.expenseId === fromExpenseId);
    const expense = input.expenses.find((e) => e.id === fromExpenseId);
    if (linked) initialEditId = linked.id;
    else if (expense) prefill = assetPrefillFromExpense(expense, input.gst);
    else fromExpenseMissing = true;
  }

  return (
    <>
      {header}
      <AssetsView
        assets={assets}
        expenseOptions={options}
        currentFyKey={currentFyKey}
        lowValueThreshold={input.settings.lowValueThreshold}
        gst={input.gst}
        prefill={prefill}
        initialEditId={initialEditId}
        fromExpenseMissing={fromExpenseMissing}
        filedYears={filedYears}
      />
    </>
  );
}
