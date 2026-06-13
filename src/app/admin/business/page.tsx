// src/app/admin/business/page.tsx
import { AdminPageLayout } from "@/features/admin/components/AdminPageLayout";
import {
  BusinessDashboardCards,
  type ExpenseRow,
  type IncomeRow,
  type InvoiceRow,
} from "@/features/business/components/BusinessDashboardCards";
import { SheetImportButton } from "@/features/business/components/SheetImportButton";
import { TaxPlannerSection } from "@/features/business/components/TaxPlannerSection";
import { listFinancialYears } from "@/features/business/lib/financial-year";
import { listSpreadsheetsInFolder } from "@/features/business/lib/google-drive";
import { getFySheetIdForDate } from "@/features/business/lib/sheets-sync";
import {
  clearTaxCache,
  readCachedTaxSnapshot,
  writeCachedTaxSnapshot,
} from "@/features/business/lib/tax-cache";
import { DEFAULT_TAX_RATES, type TaxRates } from "@/features/business/lib/tax-planner";
import { readPlannerConfig } from "@/features/business/lib/tax-settings";
import { requireAdminAuth } from "@/shared/lib/auth";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { cn } from "@/shared/lib/cn";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Business - Admin",
  robots: { index: false, follow: false },
};

/** Possible scope query values: "all" or an FY key like "2025-26". */
const SCOPE_PARAM = "fy";

/**
 * Resolves the displayed scope from a search-param value.
 * "all" > the all-time scope (no date filter).
 * Otherwise tries to match an FY key (e.g. "2025-26") against the listed FYs.
 * Falls back to the current FY when the param is missing or doesn't match.
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
 * @param root0 - Page props.
 * @param root0.searchParams - URL search params (`?fy=` scope + optional `?refresh=1` cache-bust).
 * @returns Business dashboard element.
 */
export default async function BusinessPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string; refresh?: string }>;
}): Promise<React.ReactElement> {
  await requireAdminAuth("/admin/business");
  const { fy: fyParam, refresh } = await searchParams;

  // ?refresh=1 invalidates every cached scope so the next render hits the live
  // Google APIs. Useful when the operator edits the Sheet directly and wants
  // the dashboard to pick up the change immediately.
  const forceRefresh = refresh === "1";
  if (forceRefresh) await clearTaxCache();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Business start date (from identity settings) drives the FY list + "(partial)" label.
  const startDate = new Date((await getIdentity()).startDateIso);
  const scope = resolveScope(fyParam, now, startDate);

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

  // Pull the per-FY rates from the workbook's SETTINGS tab. The sheet stays
  // authoritative; the live tax settings are the fallback for any cell it
  // doesn't fill (and the source when there's no workbook at all). Cached per
  // scope since the Drive/Sheets reads cost 3-5s on a miss.
  const settings = await getSettings();
  const taxSettings = settings.tax;
  const gstRegistered = settings.pricing.gstRegistered;
  let rates: TaxRates = {
    incomeTax: taxSettings.incomeTax,
    acc: taxSettings.acc,
    kiwiSaver: taxSettings.kiwiSaver,
    gstOutOfInclusive: DEFAULT_TAX_RATES.gstOutOfInclusive,
  };

  const cached = forceRefresh ? null : await readCachedTaxSnapshot(scope.key);
  if (cached) {
    rates = cached.rates;
  } else {
    try {
      let configSpreadsheetId: string | null = null;

      if (scope.isAllTime) {
        const folderId = process.env.GOOGLE_BUSINESS_SHEETS_FOLDER_ID?.trim();
        if (folderId) {
          const allSheets = await listSpreadsheetsInFolder(folderId);
          // For All time, use the most recent workbook for rates.
          configSpreadsheetId = allSheets[allSheets.length - 1]?.fileId ?? null;
        }
      } else if (scope.startISO) {
        configSpreadsheetId = await getFySheetIdForDate(new Date(scope.startISO));
      }

      if (configSpreadsheetId) {
        const config = await readPlannerConfig(configSpreadsheetId, taxSettings);
        if (config) {
          rates = config.rates;
        }
      }

      // Persist the snapshot - failures non-fatal, just stays cold next time.
      try {
        await writeCachedTaxSnapshot(scope.key, { rates });
      } catch (cacheErr) {
        console.error("[business/page] tax-cache write failed (non-fatal):", cacheErr);
      }
    } catch (err) {
      console.error("[business/page] Failed to read planner config:", err);
    }
  }

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
   * Builds the URL for a tab, preserving the admin token.
   * @param tabKey - The tab's scope key (e.g. "all" or "2026-27").
   * @returns Relative URL.
   */
  function tabHref(tabKey: string): string {
    return `/admin/business?${SCOPE_PARAM}=${encodeURIComponent(tabKey)}`;
  }

  const links = [
    { label: "Income", href: `/admin/business/income` },
    { label: "Expenses", href: `/admin/business/expenses` },
    { label: "Invoices", href: `/admin/business/invoices` },
    { label: "Calculator", href: `/admin/business/calculator` },
  ];

  return (
    <AdminPageLayout current="business">
      <h1 className={cn("mb-6 text-2xl font-extrabold text-russian-violet")}>Business</h1>

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
                  : "border-slate-300 bg-white text-slate-600 hover:border-russian-violet/50 hover:text-russian-violet",
              )}
            >
              {tab.label}
              {tab.current && !active && (
                <span
                  className={cn(
                    "ml-2 rounded-full bg-moonstone-600/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-moonstone-600 uppercase",
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
        gstRegistered={gstRegistered}
        rates={rates}
      />

      {/* Action links - full-width stacked on mobile, side-by-side from sm+. */}
      <div className={cn("flex flex-col gap-3 sm:flex-row sm:flex-wrap")}>
        {links.map((l) => (
          <Link
            key={l.label}
            href={l.href}
            className={cn(
              "rounded-lg bg-russian-violet px-4 py-2 text-center text-sm font-medium text-white transition-opacity hover:opacity-90 sm:w-auto sm:text-left",
            )}
          >
            {l.label}
          </Link>
        ))}
      </div>

      <SheetImportButton />
    </AdminPageLayout>
  );
}
