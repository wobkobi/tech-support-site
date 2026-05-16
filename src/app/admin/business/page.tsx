// src/app/admin/business/page.tsx
import type { Metadata } from "next";
import type React from "react";
import Link from "next/link";
import { requireAdminToken } from "@/shared/lib/auth";
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import { cn } from "@/shared/lib/cn";
import { prisma } from "@/shared/lib/prisma";
import { listFinancialYears } from "@/features/business/lib/financial-year";
import { SheetImportButton } from "@/features/business/components/SheetImportButton";
import { TaxPlannerSection } from "@/features/business/components/TaxPlannerSection";
import { getFySheetIdForDate } from "@/features/business/lib/sheets-sync";
import { listSpreadsheetsInFolder } from "@/features/business/lib/google-drive";
import {
  readTaxPayments,
  sumPaymentsByType,
  computeRecurringTotals,
  combineTotals,
  type WeeklyTransferAmounts,
} from "@/features/business/lib/tax-payments";
import { readPlannerConfig } from "@/features/business/lib/tax-settings";
import {
  DEFAULT_TAX_RATES,
  RECURRING_TRANSFERS_STARTED_AT,
  computeTaxPlan,
  type TaxRates,
} from "@/features/business/lib/tax-planner";
import {
  readCachedTaxSnapshot,
  writeCachedTaxSnapshot,
  clearTaxCache,
} from "@/features/business/lib/tax-cache";
import {
  BusinessDashboardCards,
  type IncomeRow,
  type ExpenseRow,
  type InvoiceRow,
} from "@/features/business/components/BusinessDashboardCards";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Business - Admin",
  robots: { index: false, follow: false },
};

/** Possible scope query values: "all" or an FY key like "2025-26". */
const SCOPE_PARAM = "fy";

/**
 * Resolves the displayed scope from a search-param value.
 * "all" → the all-time scope (no date filter).
 * Otherwise tries to match an FY key (e.g. "2025-26") against the listed FYs.
 * Falls back to the current FY when the param is missing or doesn't match.
 * @param raw - Raw `?fy=` query value (undefined, "all", or an FY key).
 * @param now - Reference time used to enumerate financial years.
 * @returns Resolved scope.
 */
function resolveScope(
  raw: string | undefined,
  now: Date,
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
  const fys = listFinancialYears(now);
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
 * Filters a date-bearing array by an optional half-open ISO window.
 * Pass null bounds to skip filtering (used by the all-time scope).
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
 * Business dashboard. The selected scope (All time / Current FY / a past FY)
 * comes from `?fy=` and drives every total: overview cards, breakdown modals,
 * tax planner, and the bottom-of-page invoice/income/expense links. Past-FY
 * scopes hide the "This month" cards since the current calendar month falls
 * outside the FY window.
 * @param root0 - Page props
 * @param root0.searchParams - URL search parameters containing the admin token and optional `fy` scope.
 * @returns Business dashboard element
 */
export default async function BusinessPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; fy?: string; refresh?: string }>;
}): Promise<React.ReactElement> {
  const { token, fy: fyParam, refresh } = await searchParams;
  const t = requireAdminToken(token);

  // ?refresh=1 invalidates every cached scope so the next render hits the live
  // Google APIs. Useful when the operator edits the Sheet directly and wants
  // the dashboard to pick up the change immediately.
  const forceRefresh = refresh === "1";
  if (forceRefresh) await clearTaxCache();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const scope = resolveScope(fyParam, now);

  const [incomeEntries, expenseEntries, invoices] = await Promise.all([
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
        amountExcl: true,
        gstAmount: true,
      },
    }),
    prisma.invoice.findMany({
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
  ]);

  // Plain-data shapes for the client component (avoids passing Date objects across the boundary).
  const incomeAll: IncomeRow[] = incomeEntries.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    customer: e.customer,
    description: e.description,
    amount: e.amount,
  }));
  const expensesAll: ExpenseRow[] = expenseEntries.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    supplier: e.supplier,
    description: e.description,
    amountExcl: e.amountExcl,
    gstAmount: e.gstAmount,
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

  // Aggregates for the tax planner.
  const scopedIncomeTotal = income.reduce((s, r) => s + r.amount, 0);
  const scopedExpensesTotal = expenses.reduce((s, r) => s + r.amountExcl, 0);
  const scopedGstTotal = expenses.reduce((s, r) => s + r.gstAmount, 0);

  // Pull actuals + planner config from the FY workbook(s). Cached per scope
  // since the Drive/Sheets reads cost 3-5s on a miss.
  let paymentTotals: ReturnType<typeof sumPaymentsByType> | null = null;
  let rates: TaxRates = DEFAULT_TAX_RATES;
  let weeklyAmounts: WeeklyTransferAmounts = { kiwiSaver: 0, incomeTax: 0 };
  let scheduleStart: Date | null = null;

  const cached = forceRefresh ? null : await readCachedTaxSnapshot(scope.key);
  if (cached) {
    paymentTotals = cached.paymentTotals;
    rates = cached.rates;
    weeklyAmounts = cached.weeklyAmounts;
    scheduleStart = cached.scheduleStartISO ? new Date(cached.scheduleStartISO) : null;
  } else {
    try {
      let logged: ReturnType<typeof sumPaymentsByType> | null = null;
      let configSpreadsheetId: string | null = null;

      if (scope.isAllTime) {
        const folderId = process.env.GOOGLE_BUSINESS_SHEETS_FOLDER_ID?.trim();
        if (folderId) {
          const allSheets = await listSpreadsheetsInFolder(folderId);
          const allPaymentLists = await Promise.all(
            allSheets.map((s) => readTaxPayments(s.fileId)),
          );
          logged = sumPaymentsByType(allPaymentLists.flat());
          // For All time, use the most recent workbook for rates.
          configSpreadsheetId = allSheets[allSheets.length - 1]?.fileId ?? null;
        }
      } else if (scope.startISO) {
        const spreadsheetId = await getFySheetIdForDate(new Date(scope.startISO));
        if (spreadsheetId) {
          const payments = await readTaxPayments(spreadsheetId);
          logged = sumPaymentsByType(payments);
          configSpreadsheetId = spreadsheetId;
        }
      }

      if (configSpreadsheetId) {
        const config = await readPlannerConfig(configSpreadsheetId);
        if (config) {
          rates = config.rates;
          weeklyAmounts = { kiwiSaver: config.weeklyKiwiSaver, incomeTax: config.weeklyTax };
          // SETTINGS wins; falls back to the code constant.
          scheduleStart = config.transferStartDate ?? new Date(RECURRING_TRANSFERS_STARTED_AT);
        }
      }

      // Targets to split the weekly tax transfer across income tax / ACC / GST.
      const planForSplit = computeTaxPlan(
        scopedIncomeTotal,
        scopedExpensesTotal,
        scopedGstTotal,
        rates,
      );
      const taxBucketTargets = {
        incomeTax: planForSplit.setAsides.incomeTax,
        acc: planForSplit.setAsides.acc,
        gst: 0, // GST has its own line in the plan; tax bucket only covers income tax + ACC for now.
      };

      // Recurring window: scope range, or "since schedule start" for All time.
      const recurringStart = scope.startISO ? new Date(scope.startISO) : new Date(0);
      const recurringEnd = scope.endISO ? new Date(scope.endISO) : new Date(now.getTime() + 1);
      const recurring = computeRecurringTotals(
        weeklyAmounts,
        scheduleStart,
        recurringStart,
        recurringEnd,
        now,
        taxBucketTargets,
      );

      paymentTotals = logged ? combineTotals(logged, recurring) : recurring;

      // Persist the snapshot - failures non-fatal, just stays cold next time.
      try {
        await writeCachedTaxSnapshot(scope.key, {
          paymentTotals,
          rates,
          weeklyAmounts,
          scheduleStartISO: scheduleStart ? scheduleStart.toISOString() : null,
        });
      } catch (cacheErr) {
        console.error("[business/page] tax-cache write failed (non-fatal):", cacheErr);
      }
    } catch (err) {
      console.error("[business/page] Failed to read tax payments:", err);
    }
  }

  // Tab list - "All time" first, then each FY most-recent first.
  const fyList = listFinancialYears(now);
  const tabs: { key: string; label: string; current: boolean }[] = [
    { key: "all", label: "All time", current: false },
    ...fyList.map((fy) => ({
      key: fy.label.match(/(\d{4}-\d{2})/)?.[1] ?? fy.label,
      label: fy.label,
      current: fy.current,
    })),
  ];

  /**
   * Builds the URL for a tab, preserving the admin token.
   * @param tabKey - The tab's scope key (e.g. "all" or "2026-27").
   * @returns Relative URL.
   */
  function tabHref(tabKey: string): string {
    return `/admin/business?token=${encodeURIComponent(t)}&${SCOPE_PARAM}=${encodeURIComponent(tabKey)}`;
  }

  const links = [
    { label: "Income", href: `/admin/business/income?token=${encodeURIComponent(t)}` },
    { label: "Expenses", href: `/admin/business/expenses?token=${encodeURIComponent(t)}` },
    { label: "Invoices", href: `/admin/business/invoices?token=${encodeURIComponent(t)}` },
    { label: "Calculator", href: `/admin/business/calculator?token=${encodeURIComponent(t)}` },
  ];

  return (
    <AdminPageLayout token={t} current="business">
      <h1 className={cn("text-russian-violet mb-6 text-2xl font-extrabold")}>Business</h1>

      {/* FY scope selector */}
      <div
        role="tablist"
        aria-label="Financial year scope"
        className={cn("mb-6 flex flex-wrap gap-2")}
      >
        {tabs.map((tab) => {
          const active = tab.key === scope.key;
          return (
            <Link
              key={tab.key}
              href={tabHref(tab.key)}
              role="tab"
              aria-selected={active}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors",
                active
                  ? "border-russian-violet bg-russian-violet text-white"
                  : "hover:border-russian-violet/50 hover:text-russian-violet border-slate-300 bg-white text-slate-600",
              )}
            >
              {tab.label}
              {tab.current && !active && (
                <span
                  className={cn(
                    "bg-moonstone-600/15 text-moonstone-600 ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  )}
                >
                  Current
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <BusinessDashboardCards
        token={t}
        scope={{
          label: scope.label,
          isAllTime: scope.isAllTime,
          isCurrentFy: scope.isCurrentFy,
        }}
        income={income}
        expenses={expenses}
        invoices={invoiceRows}
        monthStartISO={monthStart.toISOString()}
        monthEndISO={monthEnd.toISOString()}
      />

      <TaxPlannerSection
        fyLabel={scope.label}
        income={scopedIncomeTotal}
        expensesExcl={scopedExpensesTotal}
        gstClaimable={scopedGstTotal}
        actuals={paymentTotals}
        rates={rates}
      />

      <div className={cn("flex flex-wrap gap-3")}>
        {links.map((l) => (
          <Link
            key={l.label}
            href={l.href}
            className={cn(
              "bg-russian-violet rounded-lg px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90",
            )}
          >
            {l.label}
          </Link>
        ))}
      </div>

      <SheetImportButton token={t} />
    </AdminPageLayout>
  );
}
