// src/app/admin/(shell)/business/page.tsx
// Business dashboard for the `?fy=` scope: totals cards, income vs expenses chart and a
// tax card. Figures are incl. GST while unregistered, excl. once registered.

import { BarChart } from "@/features/admin/components/charts/BarChart";
import { incomeExpenseSeries } from "@/features/admin/components/charts/series";
import { AdminButton } from "@/features/admin/components/ui/AdminButton";
import { AdminTabs } from "@/features/admin/components/ui/AdminTabs";
import { PageHeader } from "@/features/admin/components/ui/PageHeader";
import { StickyRail } from "@/features/admin/components/ui/StickyRail";
import {
  BusinessDashboardCards,
  type ExpenseRow,
  type IncomeRow,
  type InvoiceRow,
} from "@/features/business/components/BusinessDashboardCards";
import { SheetImportButton } from "@/features/business/components/SheetImportButton";
import { TaxSummaryCard } from "@/features/business/components/tax/TaxSummaryCard";
import { listFinancialYears } from "@/features/business/lib/financial-year";
import { NOT_A_QUOTE_FILTER } from "@/features/business/lib/invoice-status";
import { fyMonthGroups, fyTotalGroups } from "@/features/business/lib/ledger-chart";
import { setAsideTargets } from "@/features/business/lib/tax";
import {
  expenseTaxBasis,
  gstStatusFromPricing,
  incomeTaxBasis,
  isGstRegisteredOn,
} from "@/features/business/lib/tax/gst-basis";
import { loadAllFys, loadTaxInputs } from "@/features/business/lib/tax/load";
import { loadShownResults } from "@/features/business/lib/tax/view.server";
import { gstToPay, sumTaxEstimates } from "@/features/business/lib/tax/workings";
import { requireAdminAuth } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { nzDateParts, nzMidnightUtc } from "@/shared/lib/timezone-utils";
import type { Metadata } from "next";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Business - Admin",
  robots: { index: false, follow: false },
};

/** Possible scope query values: "all" or an FY key like "2025-26". */
const SCOPE_PARAM = "fy";

/**
 * Resolves the scope from `?fy=`: "all", a listed FY key (e.g. "2025-26"), else the current FY.
 * @param raw - Raw `?fy=` query value (undefined, "all", or an FY key).
 * @param now - Reference time used to enumerate financial years.
 * @param startDate - Business start date (first FY listed).
 * @returns Resolved scope.
 */
function resolveScope(
  raw: string | undefined,
  now: Date,
  startDate: Date,
): {
  key: string;
  label: string;
  startISO: string | null;
  endISO: string | null;
  isAllTime: boolean;
  isCurrentFy: boolean;
} {
  if (raw === "all") {
    return {
      key: "all",
      label: "All time",
      startISO: null,
      endISO: null,
      isAllTime: true,
      isCurrentFy: false,
    };
  }
  const fys = listFinancialYears(now, startDate);
  const target = raw ? fys.find((f) => f.label.includes(raw)) : null;
  const fy = target ?? fys.find((f) => f.current) ?? fys[0];
  if (!fy) {
    // No FYs at all (no business start date set) - fall back to all-time.
    return {
      key: "all",
      label: "All time",
      startISO: null,
      endISO: null,
      isAllTime: true,
      isCurrentFy: false,
    };
  }
  const fyKey = fy.label.match(/(\d{4}-\d{2})/)?.[1] ?? "";
  return {
    key: fyKey,
    label: fy.label,
    startISO: fy.start.toISOString(),
    endISO: fy.end.toISOString(),
    isAllTime: false,
    isCurrentFy: fy.current,
  };
}

/**
 * Filters a date-bearing array by an optional half-open ISO window (null bounds skip it).
 * @param entries - Items with an ISO `date` field.
 * @param startISO - Inclusive lower bound, or null for no lower bound.
 * @param endISO - Exclusive upper bound, or null for no upper bound.
 * @returns Filtered entries.
 */
function filterByScope<T extends { date: string }>(
  entries: T[],
  startISO: string | null,
  endISO: string | null,
): T[] {
  if (!startISO || !endISO) return entries;
  return entries.filter((e) => e.date >= startISO && e.date < endISO);
}

/**
 * Business dashboard. The `?fy=` scope drives every total; past-FY scopes hide the
 * "This month" cards.
 * @param root0 - Page props.
 * @param root0.searchParams - URL search params (`?fy=` scope).
 * @returns Business dashboard element.
 */
export default async function BusinessPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth("/admin/business");
  const { fy: fyParam } = await searchParams;

  const now = new Date();
  // "This month" on NZ midnight boundaries, since the server runs in UTC.
  const [nzYear, nzMonth] = nzDateParts(now);
  const monthStart = nzMidnightUtc(nzYear, nzMonth, 1);
  const monthEnd = nzMidnightUtc(nzYear, nzMonth + 1, 1);

  // One parallel pass over independent reads; tax inputs are filtered to the scope later.
  const [identity, incomeEntries, expenseEntries, invoices, settings, allTaxInputs] =
    await Promise.all([
      getIdentity(),
      prisma.incomeEntry.findMany({
        orderBy: { date: "desc" },
        select: { id: true, date: true, customer: true, description: true, amount: true },
      }),
      prisma.expenseEntry.findMany({
        orderBy: { date: "desc" },
        select: {
          id: true,
          date: true,
          supplier: true,
          description: true,
          amountIncl: true,
          amountExcl: true,
          gstAmount: true,
        },
      }),
      prisma.invoice.findMany({
        // Quotes are excluded: a quoted total is not revenue.
        where: { ...NOT_A_QUOTE_FILTER },
        orderBy: { issueDate: "desc" },
        select: {
          id: true,
          number: true,
          clientName: true,
          issueDate: true,
          total: true,
          status: true,
        },
      }),
      getSettings(),
      loadAllFys(now).then((fys) => Promise.all(fys.map((f) => loadTaxInputs(f, now)))),
    ]);

  // Business start date (from identity settings) drives the FY list + "(partial)" label.
  const startDate = new Date(identity.startDateIso);
  const scope = resolveScope(fyParam, now, startDate);
  // GST basis: incl. GST before registration, excl. GST after.
  const gst = gstStatusFromPricing(settings.pricing);

  // Plain-data shapes for the client component (avoids passing Date objects across the boundary).
  const incomeAll: IncomeRow[] = incomeEntries.map((e) => {
    const date = e.date.toISOString();
    return {
      id: e.id,
      date,
      customer: e.customer,
      description: e.description,
      amount: e.amount,
      basisAmount: incomeTaxBasis({ date, amount: e.amount }, gst),
    };
  });
  const expensesAll: ExpenseRow[] = expenseEntries.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    supplier: e.supplier,
    description: e.description,
    gstAmount: e.gstAmount,
    basisAmount: expenseTaxBasis(e, gst),
    gstClaimable: isGstRegisteredOn(e.date, gst) ? e.gstAmount : 0,
  }));
  const invoicesAll: InvoiceRow[] = invoices.map((inv) => ({
    id: inv.id,
    number: inv.number,
    clientName: inv.clientName,
    issueDate: inv.issueDate.toISOString(),
    total: inv.total,
    status: inv.status,
  }));

  // Filter to the selected scope.
  const income = filterByScope(incomeAll, scope.startISO, scope.endISO);
  const expenses = filterByScope(expensesAll, scope.startISO, scope.endISO);
  const invoiceRows = invoicesAll.filter((inv) => {
    if (!scope.startISO || !scope.endISO) return true;
    return inv.issueDate >= scope.startISO && inv.issueDate < scope.endISO;
  });

  // Tax estimate as the Tax page shows it, per FY (filed snapshot or live), summed for "All time".
  const taxInputs = allTaxInputs.filter((input) => scope.isAllTime || input.fy.key === scope.key);
  const taxResults = await loadShownResults(taxInputs);
  const taxEstimate = taxResults.length > 0 ? sumTaxEstimates(taxResults) : null;
  // A weekly pace only means something for the year still running.
  const currentTaxInput = scope.isCurrentFy ? taxInputs[0] : undefined;
  const currentTaxResult = scope.isCurrentFy ? taxResults[0] : undefined;
  const taxTargets =
    currentTaxInput && currentTaxResult
      ? setAsideTargets(currentTaxResult.totalToSetAside, currentTaxInput.fy, now)
      : null;
  // GST roll-up; gstToPay does its own registration-date gating.
  const gstRollup = gst.registered ? gstToPay(income, expenses, gst) : null;
  const taxHref = scope.isAllTime
    ? "/admin/business/tax"
    : `/admin/business/tax?fy=${encodeURIComponent(scope.key)}`;

  // Tab list - "All time" first, then each FY most-recent first.
  const fyList = listFinancialYears(now, startDate);
  const tabs: { key: string; label: string; current: boolean }[] = [
    { key: "all", label: "All time", current: false },
    ...fyList.map((fy) => ({
      key: fy.label.match(/(\d{4}-\d{2})/)?.[1] ?? fy.label,
      label: fy.label,
      current: fy.current,
    })),
  ];

  /**
   * Builds the `?fy=` URL for a scope tab.
   * @param tabKey - The tab's scope key (e.g. "all" or "2026-27").
   * @returns Relative URL.
   */
  function tabHref(tabKey: string): string {
    return `/admin/business?${SCOPE_PARAM}=${encodeURIComponent(tabKey)}`;
  }

  // Chart groups (months in an FY, FYs for all time) cover every scoped row, matching the cards.
  const chartRows = {
    income: income.map((r) => ({ date: r.date, amount: r.basisAmount })),
    expenses: expenses.map((e) => ({ date: e.date, amount: e.basisAmount })),
  };
  const chartGroups =
    scope.startISO && scope.endISO
      ? fyMonthGroups(chartRows, { startISO: scope.startISO, endISO: scope.endISO }, startDate, now)
      : fyTotalGroups(chartRows, fyList, startDate, now);

  const links = [
    { label: "Income", href: `/admin/business/income` },
    { label: "Expenses", href: `/admin/business/expenses` },
    { label: "Invoices", href: `/admin/business/invoices` },
    { label: "Calculator", href: `/admin/business/calculator` },
  ];

  return (
    <>
      <PageHeader
        title="Business"
        // Outline so none reads as primary.
        actions={links.map((l) => (
          <AdminButton key={l.label} href={l.href} variant="outline">
            {l.label}
          </AdminButton>
        ))}
      />

      {/* FY scope selector: links, so `?fy=` stays the source of truth. */}
      <AdminTabs
        aria-label="Financial year scope"
        active={scope.key}
        className="mb-6"
        tabs={tabs.map((tab) => ({
          key: tab.key,
          label: tab.label,
          href: tabHref(tab.key),
          badge:
            tab.current && tab.key !== scope.key ? (
              <span className="rounded-full bg-moonstone-400/15 px-2 py-0.5 text-sm font-bold text-moonstone-700">
                Current
              </span>
            ) : undefined,
        }))}
      />

      <BusinessDashboardCards
        scope={{
          label: scope.label,
          isAllTime: scope.isAllTime,
          isCurrentFy: scope.isCurrentFy,
          gstRegistered: gst.registered,
        }}
        income={income}
        expenses={expenses}
        invoices={invoiceRows}
        monthStartISO={monthStart.toISOString()}
        monthEndISO={monthEnd.toISOString()}
        taxEstimate={taxEstimate}
        taxHref={taxHref}
      />

      {/* Chart beside a pinned tax + import column from xl; stacked below it. */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem] xl:items-start">
        <BarChart
          // Remount per scope so hover, focus and the tab stop don't carry over.
          key={scope.key}
          title={
            scope.isAllTime ? "Income vs expenses by financial year" : "Income vs expenses by month"
          }
          description={scope.label}
          series={incomeExpenseSeries(gst.registered)}
          groups={chartGroups}
          groupHeading={scope.isAllTime ? "Financial year" : "Month"}
          differenceLabel="Profit"
          emptyText="No income or expenses recorded in this period."
        />

        <StickyRail className="flex flex-col gap-6">
          <TaxSummaryCard
            scopeLabel={scope.label}
            isAllTime={scope.isAllTime}
            estimate={taxEstimate}
            targets={taxTargets}
            gst={gstRollup}
            gstRegisteredFrom={gst.registeredFrom}
            href={taxHref}
          />
          <SheetImportButton />
        </StickyRail>
      </div>
    </>
  );
}
