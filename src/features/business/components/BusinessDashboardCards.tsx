"use client";
// src/features/business/components/BusinessDashboardCards.tsx
/**
 * @description Renders the overview stat cards for the business dashboard,
 * scoped to whatever FY (or "All time") was selected by the parent page. Each
 * card is a button that opens a BreakdownModal listing the contributing rows
 * (or showing the calculation steps), so any value that looks off can be
 * inspected without leaving the page.
 *
 * Past-FY scopes hide the "This month" cards, since the current calendar
 * month falls outside the FY window and would always show zero.
 */

import { StatCard, type StatTone } from "@/features/admin/components/ui/StatCard";
import {
  BreakdownModal,
  type BreakdownData,
  type BreakdownRow,
} from "@/features/business/components/BreakdownModal";
import { formatNZD } from "@/features/business/lib/business";
import { formatDateSlash } from "@/shared/lib/date-format";
import type React from "react";
import { useState } from "react";

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
      date: formatDateSlash(e.date),
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
      date: formatDateSlash(e.date),
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
 * Overview stat cards. Each card opens a BreakdownModal explaining the value.
 * @param props - Component props.
 * @param props.scope - Current "this month" / "this FY" selection.
 * @param props.income - Income rows in scope.
 * @param props.expenses - Expense rows in scope.
 * @param props.invoices - Invoice rows in scope.
 * @param props.monthStartISO - ISO start of the active month.
 * @param props.monthEndISO - ISO end of the active month.
 * @returns Cards section.
 */
export function BusinessDashboardCards({
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
    viewAll: { label: "View all income", href: `/admin/business/income` },
  };

  /** All-expense (excl. GST) breakdown for the expenses card. */
  const totalExpensesBreakdown: BreakdownData = {
    title: expensesPrefix,
    rows: expenseRows(expenses, "amountExcl"),
    total: { label: "Total", value: formatNZD(totalExpensesExcl) },
    viewAll: { label: "View all expenses", href: `/admin/business/expenses` },
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
    viewAll: { label: "View all income", href: `/admin/business/income` },
  };

  /** This-month expense breakdown. */
  const monthExpensesBreakdown: BreakdownData = {
    title: "This month expenses",
    rows: expenseRows(monthExpenses, "amountExcl"),
    total: { label: "Total", value: formatNZD(sumExpense(monthExpenses, "amountExcl")) },
    viewAll: { label: "View all expenses", href: `/admin/business/expenses` },
  };

  /** GST claimable breakdown - shows the GST amount per expense entry. */
  const gstBreakdown: BreakdownData = {
    title: "GST claimable",
    rows: expenseRows(expenses, "gstAmount"),
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
      value: formatNZD(totalExpensesExcl),
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
      label: "Tax reserve (20%)",
      value: formatNZD(taxReserve),
      tone: "warning",
      breakdown: taxReserveBreakdown,
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
            value: formatNZD(sumExpense(monthExpenses, "amountExcl")),
            tone: "default" as StatTone,
            breakdown: monthExpensesBreakdown,
          },
        ]
      : []),
    {
      label: "GST claimable",
      value: formatNZD(totalGst),
      tone: "info",
      breakdown: gstBreakdown,
    },
    {
      label: "Invoices",
      value: String(invoices.length),
      tone: "violet",
      breakdown: invoicesBreakdown,
    },
  ];

  return (
    <>
      <p className="mb-2 text-xs font-semibold tracking-wide text-admin-muted uppercase">
        Showing: {scope.label}
      </p>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <StatCard
            key={c.label}
            label={c.label}
            value={c.value}
            tone={c.tone}
            onClick={() => setActive(c.breakdown)}
          />
        ))}
      </div>

      {active && <BreakdownModal data={active} onClose={() => setActive(null)} />}
    </>
  );
}
