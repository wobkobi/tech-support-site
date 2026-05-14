"use client";
// src/features/business/components/BusinessDashboardCards.tsx
/**
 * @file BusinessDashboardCards.tsx
 * @description Renders the overview stat cards for the business dashboard,
 * scoped to whatever FY (or "All time") was selected by the parent page. Each
 * card is a button that opens a BreakdownModal listing the contributing rows
 * (or showing the calculation steps), so any value that looks off can be
 * inspected without leaving the page.
 *
 * Past-FY scopes hide the "This month" cards, since the current calendar
 * month falls outside the FY window and would always show zero.
 */

import { useState } from "react";
import type React from "react";
import { cn } from "@/shared/lib/cn";
import { formatNZD, formatNZDate } from "@/features/business/lib/business";
import {
  BreakdownModal,
  type BreakdownData,
  type BreakdownRow,
} from "@/features/business/components/BreakdownModal";

/** Income entry payload passed in from the server component (already scope-filtered). */
export interface IncomeRow {
  id: string;
  date: string; // ISO
  customer: string;
  description: string;
  amount: number;
}

/** Expense entry payload passed in from the server component (already scope-filtered). */
export interface ExpenseRow {
  id: string;
  date: string; // ISO
  supplier: string;
  description: string;
  amountExcl: number;
  gstAmount: number;
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
export interface DashboardScope {
  label: string;
  isAllTime: boolean;
  isCurrentFy: boolean;
}

interface Props {
  token: string;
  scope: DashboardScope;
  income: IncomeRow[];
  expenses: ExpenseRow[];
  invoices: InvoiceRow[];
  monthStartISO: string;
  monthEndISO: string;
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
      date: formatNZDate(e.date),
      label: e.customer,
      sublabel: e.description,
      amount: e.amount,
    }));
}

/**
 * Builds the BreakdownRow list for expense entries.
 * @param entries - Expense entries to map.
 * @param field - Which numeric field to display (excl. GST or GST amount).
 * @returns Modal rows.
 */
function expenseRows(entries: ExpenseRow[], field: "amountExcl" | "gstAmount"): BreakdownRow[] {
  return entries
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((e) => ({
      date: formatNZDate(e.date),
      label: e.supplier,
      sublabel: e.description,
      amount: field === "amountExcl" ? e.amountExcl : e.gstAmount,
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
 * Sums the `amount` field of an income list.
 * @param rows - Income rows.
 * @returns Sum.
 */
function sumIncome(rows: IncomeRow[]): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}

/**
 * Sums a chosen numeric field across an expense list.
 * @param rows - Expense rows.
 * @param field - "amountExcl" or "gstAmount".
 * @returns Sum.
 */
function sumExpense(rows: ExpenseRow[], field: "amountExcl" | "gstAmount"): number {
  return rows.reduce((s, r) => s + r[field], 0);
}

/**
 * Overview stat cards driven by the scope selected on the parent page. Each
 * card is a button that opens a BreakdownModal explaining the value (rows
 * that summed to it, or the calculation that produced it).
 * @param props - Component props.
 * @param props.token - Admin token used by the inner breakdown modal.
 * @param props.scope - Current "this month" / "this FY" selection from the parent.
 * @param props.income - Income rows in scope.
 * @param props.expenses - Expense rows in scope.
 * @param props.invoices - Invoice rows in scope.
 * @param props.monthStartISO - ISO timestamp for the start of the active month.
 * @param props.monthEndISO - ISO timestamp for the end of the active month.
 * @returns Cards section.
 */
export function BusinessDashboardCards({
  token,
  scope,
  income,
  expenses,
  invoices,
  monthStartISO,
  monthEndISO,
}: Props): React.ReactElement {
  const [active, setActive] = useState<BreakdownData | null>(null);

  const totalIncome = sumIncome(income);
  const totalExpensesExcl = sumExpense(expenses, "amountExcl");
  const totalGst = sumExpense(expenses, "gstAmount");
  const profit = totalIncome - totalExpensesExcl;
  // Income-tax reserve is 20% of PROFIT (not raw income) - matches NZ sole-trader
  // Tax Planner. Clamp to >= 0 so a loss year doesn't show a negative reserve.
  const taxReserve = Math.max(0, profit) * 0.2;
  const monthIncome = inRange(income, monthStartISO, monthEndISO);
  const monthExpenses = inRange(expenses, monthStartISO, monthEndISO);

  const tokenSuffix = `?token=${encodeURIComponent(token)}`;
  const showThisMonthCards = scope.isAllTime || scope.isCurrentFy;
  // Card titles read more naturally as "Income" / "Expenses" inside an FY
  // scope, but stay as "Total income" / "Total expenses" in the all-time view.
  const incomePrefix = scope.isAllTime ? "Total income" : "Income";
  const expensesPrefix = scope.isAllTime ? "Total expenses (excl. GST)" : "Expenses (excl. GST)";

  /** All-income breakdown shown when the income card is clicked. */
  const totalIncomeBreakdown: BreakdownData = {
    title: incomePrefix,
    rows: incomeRows(income),
    total: { label: "Total", value: formatNZD(totalIncome) },
    viewAll: { label: "View all income →", href: `/admin/business/income${tokenSuffix}` },
  };

  /** All-expense (excl. GST) breakdown for the expenses card. */
  const totalExpensesBreakdown: BreakdownData = {
    title: expensesPrefix,
    rows: expenseRows(expenses, "amountExcl"),
    total: { label: "Total", value: formatNZD(totalExpensesExcl) },
    viewAll: { label: "View all expenses →", href: `/admin/business/expenses${tokenSuffix}` },
  };

  /** Calculation walk-through for "Profit". */
  const profitBreakdown: BreakdownData = {
    title: "Profit",
    calculation: [
      { label: incomePrefix, value: formatNZD(totalIncome) },
      { label: expensesPrefix, value: formatNZD(totalExpensesExcl), subtract: true },
    ],
    total: { label: "Profit", value: formatNZD(profit) },
  };

  /** Calculation walk-through for "Tax reserve (20%)". Profit-based, clamped at 0. */
  const taxReserveBreakdown: BreakdownData = {
    title: "Tax reserve (20%)",
    calculation: [
      { label: incomePrefix, value: formatNZD(totalIncome) },
      { label: expensesPrefix, value: formatNZD(totalExpensesExcl), subtract: true },
      { label: "Profit", value: formatNZD(profit) },
      { label: "Tax rate", value: "20%" },
    ],
    total: { label: "Tax reserve", value: formatNZD(taxReserve) },
  };

  /** This-month income breakdown. */
  const monthIncomeBreakdown: BreakdownData = {
    title: "This month income",
    rows: incomeRows(monthIncome),
    total: { label: "Total", value: formatNZD(sumIncome(monthIncome)) },
    viewAll: { label: "View all income →", href: `/admin/business/income${tokenSuffix}` },
  };

  /** This-month expense breakdown. */
  const monthExpensesBreakdown: BreakdownData = {
    title: "This month expenses",
    rows: expenseRows(monthExpenses, "amountExcl"),
    total: { label: "Total", value: formatNZD(sumExpense(monthExpenses, "amountExcl")) },
    viewAll: { label: "View all expenses →", href: `/admin/business/expenses${tokenSuffix}` },
  };

  /** GST claimable breakdown - shows the GST amount per expense entry. */
  const gstBreakdown: BreakdownData = {
    title: "GST claimable",
    rows: expenseRows(expenses, "gstAmount"),
    total: { label: "Total GST", value: formatNZD(totalGst) },
    viewAll: { label: "View all expenses →", href: `/admin/business/expenses${tokenSuffix}` },
  };

  /** Invoice list breakdown. */
  const invoicesBreakdown: BreakdownData = {
    title: "Invoices",
    rows: invoices
      .slice()
      .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
      .map((inv) => ({
        date: formatNZDate(inv.issueDate),
        label: inv.number,
        sublabel: `${inv.clientName} - ${inv.status}`,
        amount: inv.total,
      })),
    total: { label: "Count", value: String(invoices.length) },
    viewAll: { label: "View all invoices →", href: `/admin/business/invoices${tokenSuffix}` },
  };

  const cards: Array<{
    label: string;
    value: string;
    color: string;
    breakdown: BreakdownData;
  }> = [
    {
      label: incomePrefix,
      value: formatNZD(totalIncome),
      color: "text-green-600",
      breakdown: totalIncomeBreakdown,
    },
    {
      label: expensesPrefix,
      value: formatNZD(totalExpensesExcl),
      color: "text-slate-700",
      breakdown: totalExpensesBreakdown,
    },
    {
      label: "Profit",
      value: formatNZD(profit),
      color: profit >= 0 ? "text-green-600" : "text-red-600",
      breakdown: profitBreakdown,
    },
    {
      label: "Tax reserve (20%)",
      value: formatNZD(taxReserve),
      color: "text-amber-600",
      breakdown: taxReserveBreakdown,
    },
    ...(showThisMonthCards
      ? [
          {
            label: "This month income",
            value: formatNZD(sumIncome(monthIncome)),
            color: "text-green-600",
            breakdown: monthIncomeBreakdown,
          },
          {
            label: "This month expenses",
            value: formatNZD(sumExpense(monthExpenses, "amountExcl")),
            color: "text-slate-700",
            breakdown: monthExpensesBreakdown,
          },
        ]
      : []),
    {
      label: "GST claimable",
      value: formatNZD(totalGst),
      color: "text-moonstone-600",
      breakdown: gstBreakdown,
    },
    {
      label: "Invoices",
      value: String(invoices.length),
      color: "text-russian-violet",
      breakdown: invoicesBreakdown,
    },
  ];

  return (
    <>
      <p className={cn("mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500")}>
        Showing: {scope.label}
      </p>
      <div className={cn("mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4")}>
        {cards.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => setActive(c.breakdown)}
            className={cn(
              "rounded-xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition-shadow hover:shadow-md",
            )}
          >
            <p className={cn("text-xl font-extrabold", c.color)}>{c.value}</p>
            <p className={cn("mt-0.5 text-xs text-slate-500")}>{c.label}</p>
          </button>
        ))}
      </div>

      {active && <BreakdownModal data={active} onClose={() => setActive(null)} />}
    </>
  );
}
