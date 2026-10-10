"use client";
// src/features/business/components/BusinessDashboardCards.tsx
// Renders the overview stat cards for the business dashboard, scoped to whatever FY (or
// "All time") was selected by the parent page. Each card is a button that opens a
// BreakdownModal listing the contributing rows (or showing the calculation steps), so any
// value that looks off can be inspected without leaving the page.
//
// Past-FY scopes hide the "This month" cards, since the current calendar month falls
// outside the FY window and would always show zero.
//
// Income and expense figures are on the GST basis the page computes per row (basisAmount,
// gstClaimable): incl. GST while not registered, so the GST card and the "(excl. GST)"
// labels show only once registered.

import { StatCard, type StatTone } from "@/features/admin/components/ui/StatCard";
import { lastCardSpan, StatStrip } from "@/features/admin/components/ui/StatStrip";
import {
  BreakdownModal,
  type BreakdownData,
  type BreakdownRow,
} from "@/features/business/components/BreakdownModal";
import { formatNZD } from "@/features/business/lib/business";
import type { TaxEstimateSummary } from "@/features/business/lib/tax/workings";
import { formatDateSlash } from "@/shared/lib/date-format";
import type React from "react";
import { useState } from "react";

/** Income entry payload passed in from the server component (already scope-filtered). */
export interface IncomeRow {
  id: string;
  date: string; // ISO
  customer: string;
  description: string;
  /** GST-inclusive amount, as received. */
  amount: number;
  /** What the row counts as income: `amount` while unregistered or dated before registration, else excl. GST. */
  basisAmount: number;
}

/** Expense entry payload passed in from the server component (already scope-filtered). */
export interface ExpenseRow {
  id: string;
  date: string; // ISO
  supplier: string;
  description: string;
  gstAmount: number;
  /** What the row costs for profit: incl. GST while unregistered or dated before registration, else excl. */
  basisAmount: number;
  /** GST claimed back on the row: its gstAmount once registered on its date, else 0. */
  gstClaimable: number;
}

/** Invoice payload passed in from the server component (already scope-filtered). */
export interface InvoiceRow {
  id: string;
  number: string;
  clientName: string;
  issueDate: string; // ISO
  total: number;
  status: string;
}

/** Selected scope - drives card titles and which optional cards render. */
interface DashboardScope {
  label: string;
  isAllTime: boolean;
  isCurrentFy: boolean;
  /** GST registered (pricing setting); shows the GST card and the "(excl. GST)" labels. */
  gstRegistered: boolean;
}

interface Props {
  scope: DashboardScope;
  income: IncomeRow[];
  expenses: ExpenseRow[];
  invoices: InvoiceRow[];
  monthStartISO: string;
  monthEndISO: string;
  /** Tax page estimate for the same scope (FYs summed for all time), or null with no FYs. */
  taxEstimate: TaxEstimateSummary | null;
  /** Tax page link for the same scope. */
  taxHref: string;
}

/**
 * Builds the BreakdownRow list for income entries, sorted newest first.
 * @param entries - Income entries to map.
 * @returns Modal rows.
 */
function incomeRows(entries: IncomeRow[]): BreakdownRow[] {
  return entries
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((e) => ({
      date: formatDateSlash(e.date),
      label: e.customer,
      sublabel: e.description,
      amount: e.basisAmount,
    }));
}

/**
 * Builds the BreakdownRow list for expense entries.
 * @param entries - Expense entries to map.
 * @param field - Which numeric field to display (GST-basis cost or GST claimable).
 * @returns Modal rows.
 */
function expenseRows(entries: ExpenseRow[], field: "basisAmount" | "gstClaimable"): BreakdownRow[] {
  return entries
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((e) => ({
      date: formatDateSlash(e.date),
      label: e.supplier,
      sublabel: e.description,
      amount: e[field],
    }));
}

/**
 * Filters entries to those falling inside the half-open [startISO, endISO) window.
 * @param entries - Entries to filter.
 * @param startISO - Inclusive lower bound (ISO string).
 * @param endISO - Exclusive upper bound (ISO string).
 * @returns Filtered entries.
 */
function inRange<T extends { date: string }>(entries: T[], startISO: string, endISO: string): T[] {
  return entries.filter((e) => e.date >= startISO && e.date < endISO);
}

/**
 * Sums an income list on the GST basis (`basisAmount`).
 * @param rows - Income rows.
 * @returns Sum.
 */
function sumIncome(rows: IncomeRow[]): number {
  return rows.reduce((s, r) => s + r.basisAmount, 0);
}

/**
 * Sums a chosen numeric field across an expense list.
 * @param rows - Expense rows.
 * @param field - "basisAmount" or "gstClaimable".
 * @returns Sum.
 */
function sumExpense(rows: ExpenseRow[], field: "basisAmount" | "gstClaimable"): number {
  return rows.reduce((s, r) => s + r[field], 0);
}

/**
 * Overview stat cards. Each card opens a BreakdownModal explaining the value.
 * @param props - Component props.
 * @param props.scope - Current "this month" / "this FY" selection.
 * @param props.income - Income rows in scope.
 * @param props.expenses - Expense rows in scope.
 * @param props.invoices - Invoice rows in scope.
 * @param props.monthStartISO - ISO start of the active month.
 * @param props.monthEndISO - ISO end of the active month.
 * @param props.taxEstimate - Tax page estimate for the same scope, or null.
 * @param props.taxHref - Tax page link for the same scope.
 * @returns Cards section.
 */
export function BusinessDashboardCards({
  scope,
  income,
  expenses,
  invoices,
  monthStartISO,
  monthEndISO,
  taxEstimate,
  taxHref,
}: Props): React.ReactElement {
  const [active, setActive] = useState<BreakdownData | null>(null);

  const totalIncome = sumIncome(income);
  const totalExpensesBasis = sumExpense(expenses, "basisAmount");
  const totalGst = sumExpense(expenses, "gstClaimable");
  const profit = totalIncome - totalExpensesBasis;
  const taxToSetAside = taxEstimate?.totalToSetAside ?? 0;
  const monthIncome = inRange(income, monthStartISO, monthEndISO);
  const monthExpenses = inRange(expenses, monthStartISO, monthEndISO);

  const showThisMonthCards = scope.isAllTime || scope.isCurrentFy;
  // Card titles read more naturally as "Income" / "Expenses" inside an FY
  // scope, but stay as "Total income" / "Total expenses" in the all-time view.
  // "(excl. GST)" only while registered: unregistered income and expenses count with their
  // GST in.
  const gstSuffix = scope.gstRegistered ? " (excl. GST)" : "";
  const incomePrefix = (scope.isAllTime ? "Total income" : "Income") + gstSuffix;
  const expensesPrefix = (scope.isAllTime ? "Total expenses" : "Expenses") + gstSuffix;

  /** All-income breakdown shown when the income card is clicked. */
  const totalIncomeBreakdown: BreakdownData = {
    title: incomePrefix,
    rows: incomeRows(income),
    total: { label: "Total", value: formatNZD(totalIncome) },
    viewAll: { label: "View all income", href: `/admin/business/income` },
  };

  /** All-expense breakdown (GST basis) for the expenses card. */
  const totalExpensesBreakdown: BreakdownData = {
    title: expensesPrefix,
    rows: expenseRows(expenses, "basisAmount"),
    total: { label: "Total", value: formatNZD(totalExpensesBasis) },
    viewAll: { label: "View all expenses", href: `/admin/business/expenses` },
  };

  /** Calculation walk-through for "Profit". */
  const profitBreakdown: BreakdownData = {
    title: "Profit",
    calculation: [
      { label: incomePrefix, value: formatNZD(totalIncome) },
      { label: expensesPrefix, value: formatNZD(totalExpensesBasis), subtract: true },
    ],
    total: { label: "Profit", value: formatNZD(profit) },
  };

  /**
   * Calculation walk-through for "Tax to set aside", from the Tax page's estimate. Its
   * income and deductions are the tax figures (depreciation, km claim, home office and
   * exclusions applied), so they can differ from the Income and Expenses cards.
   * All time adds up finished FY figures, and a loss FY's taxable profit is $0, so on All
   * time the income and deductions are listed as plain totals rather than subtracted into
   * taxable.
   */
  const taxBreakdown: BreakdownData = {
    title: "Tax to set aside",
    note:
      taxEstimate && scope.isAllTime
        ? "Each financial year is worked out on its own, then the years are added up. A year that made a loss has $0 taxable profit, so the taxable profit here isn't the income less the deductions."
        : undefined,
    calculation: taxEstimate
      ? [
          ...(scope.isAllTime
            ? [
                {
                  label: "Income for tax, each year added up",
                  value: formatNZD(taxEstimate.income),
                },
                {
                  label: "Tax deductions, each year added up",
                  value: formatNZD(taxEstimate.deductions),
                },
                {
                  label: "Taxable profit, each year added up (a loss year counts as $0)",
                  value: formatNZD(taxEstimate.taxable),
                },
              ]
            : [
                { label: "Income for tax", value: formatNZD(taxEstimate.income) },
                {
                  label: "Tax deductions",
                  value: formatNZD(taxEstimate.deductions),
                  subtract: true,
                },
                {
                  label: "Taxable profit (never below $0)",
                  value: formatNZD(taxEstimate.taxable),
                },
              ]),
          { label: "Income tax on the NZ brackets", value: formatNZD(taxEstimate.incomeTax) },
          {
            label: "Independent earner tax credit",
            value: formatNZD(taxEstimate.ietc),
            subtract: true,
          },
          {
            label: "Income tax after the credit",
            value: formatNZD(taxEstimate.residualIncomeTax),
          },
          { label: "ACC levies", value: formatNZD(taxEstimate.acc) },
        ]
      : [],
    total: { label: "Tax to set aside", value: formatNZD(taxToSetAside) },
    viewAll: { label: "Open tax page", href: taxHref },
  };

  /** This-month income breakdown. */
  const monthIncomeBreakdown: BreakdownData = {
    title: "This month income",
    rows: incomeRows(monthIncome),
    total: { label: "Total", value: formatNZD(sumIncome(monthIncome)) },
    viewAll: { label: "View all income", href: `/admin/business/income` },
  };

  /** This-month expense breakdown. */
  const monthExpensesBreakdown: BreakdownData = {
    title: "This month expenses",
    rows: expenseRows(monthExpenses, "basisAmount"),
    total: { label: "Total", value: formatNZD(sumExpense(monthExpenses, "basisAmount")) },
    viewAll: { label: "View all expenses", href: `/admin/business/expenses` },
  };

  /** GST claimable breakdown - the GST claimed back per expense, rows with none left out. */
  const gstBreakdown: BreakdownData = {
    title: "GST claimable",
    rows: expenseRows(
      expenses.filter((e) => e.gstClaimable !== 0),
      "gstClaimable",
    ),
    total: { label: "Total GST", value: formatNZD(totalGst) },
    viewAll: { label: "View all expenses", href: `/admin/business/expenses` },
  };

  /** Invoice list breakdown. */
  const invoicesBreakdown: BreakdownData = {
    title: "Invoices",
    rows: invoices
      .slice()
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
      .map((inv) => ({
        date: formatDateSlash(inv.issueDate),
        label: inv.number,
        sublabel: `${inv.clientName} - ${inv.status}`,
        amount: inv.total,
      })),
    total: { label: "Count", value: String(invoices.length) },
    viewAll: { label: "View all invoices", href: `/admin/business/invoices` },
  };

  const cards: Array<{
    label: string;
    value: string;
    tone: StatTone;
    breakdown: BreakdownData;
  }> = [
    {
      label: incomePrefix,
      value: formatNZD(totalIncome),
      tone: "success",
      breakdown: totalIncomeBreakdown,
    },
    {
      label: expensesPrefix,
      value: formatNZD(totalExpensesBasis),
      tone: "default",
      breakdown: totalExpensesBreakdown,
    },
    {
      label: "Profit",
      value: formatNZD(profit),
      tone: profit >= 0 ? "success" : "critical",
      breakdown: profitBreakdown,
    },
    {
      label: "Tax to set aside",
      value: formatNZD(taxToSetAside),
      tone: "warning",
      breakdown: taxBreakdown,
    },
    ...(showThisMonthCards
      ? [
          {
            label: "This month income",
            value: formatNZD(sumIncome(monthIncome)),
            tone: "success" as StatTone,
            breakdown: monthIncomeBreakdown,
          },
          {
            label: "This month expenses",
            value: formatNZD(sumExpense(monthExpenses, "basisAmount")),
            tone: "default" as StatTone,
            breakdown: monthExpensesBreakdown,
          },
        ]
      : []),
    // Nothing is claimable while unregistered, so the card would only ever read $0.00.
    ...(scope.gstRegistered
      ? [
          {
            label: "GST claimable",
            value: formatNZD(totalGst),
            tone: "info" as StatTone,
            breakdown: gstBreakdown,
          },
        ]
      : []),
    {
      label: "Invoices",
      value: String(invoices.length),
      tone: "violet",
      breakdown: invoicesBreakdown,
    },
  ];

  return (
    <>
      <p className="mb-2 text-sm font-semibold tracking-wide text-admin-muted uppercase">
        Showing: {scope.label}
      </p>
      <StatStrip label={`Totals for ${scope.label}`} className="mb-6 grid-cols-2 sm:grid-cols-4">
        {cards.map((c, i) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={c.value}
            tone={c.tone}
            onClick={() => setActive(c.breakdown)}
            className={
              i === cards.length - 1 ? lastCardSpan(cards.length, { base: 2, sm: 4 }) : undefined
            }
          />
        ))}
      </StatStrip>

      {active && <BreakdownModal data={active} onClose={() => setActive(null)} />}
    </>
  );
}
