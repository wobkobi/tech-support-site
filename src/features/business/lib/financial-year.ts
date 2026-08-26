// src/features/business/lib/financial-year.ts
/**
 * @description NZ financial year (1 April - 31 March) bucketing for the business
 * dashboard. The FY containing a date is named after the START year; e.g. dates
 * in Apr 2025 - Mar 2026 belong to "FY 2025-26".
 */

import { nzDayStartUtc } from "@/shared/lib/timezone-utils";

/** Index of April in JS Date (0 = January). */
const APRIL = 3;

/**
 * Code default for the business start date; the live value comes from
 * `identity.startDateIso`, threaded in by the server-side callers.
 */
const DEFAULT_START_DATE = new Date("2025-10-01T00:00:00Z");

/**
 * Computes the start year of the NZ financial year that contains `date`.
 * Reads UTC parts: every date reaching here has been through
 * {@link nzDayStartUtc}, so its UTC calendar day IS its NZ calendar day.
 * @param date - Any date.
 * @returns Start year (e.g. 2025 for any date in Apr 2025 - Mar 2026).
 */
function fyStartYear(date: Date): number {
  const d = nzDayStartUtc(date);
  const m = d.getUTCMonth();
  const y = d.getUTCFullYear();
  return m >= APRIL ? y : y - 1;
}

/**
 * One NZ financial year, with display label and the dates needed to bucket
 * income/expense entries.
 */
export interface FinancialYear {
  /** Display label, e.g. "FY 2025-26" or "FY 2025-26 (partial)". */
  label: string;
  /** Inclusive start date (1 April of the start year). */
  start: Date;
  /** Exclusive end date (1 April of the start year + 1). */
  end: Date;
  /** True when the business started part-way through this FY. */
  partial: boolean;
  /** True when `now` falls inside this FY. */
  current: boolean;
}

/**
 * Returns the NZ financial year that contains `date`.
 * @param date - Any date inside the desired FY.
 * @param now - "Today"; defaults to the current time.
 * @param startDate - Business start date (for the "(partial)" label).
 * @returns The financial year metadata.
 */
export function getFinancialYear(
  date: Date,
  now: Date = new Date(),
  startDate: Date = DEFAULT_START_DATE,
): FinancialYear {
  const startYear = fyStartYear(date);
  // UTC boundaries, matching how entry dates are stored - see nzDayStartUtc.
  const start = new Date(Date.UTC(startYear, APRIL, 1));
  const end = new Date(Date.UTC(startYear + 1, APRIL, 1));
  const startedOn = nzDayStartUtc(startDate);
  const today = nzDayStartUtc(now);
  const businessStartedDuringThisFy = startedOn >= start && startedOn < end;
  const current = today >= start && today < end;
  const yy = String((startYear + 1) % 100).padStart(2, "0");
  const label = `FY ${startYear}-${yy}${businessStartedDuringThisFy ? " (partial)" : ""}`;
  return { label, start, end, partial: businessStartedDuringThisFy, current };
}

/**
 * Lists every FY from the business start date through the current FY,
 * most-recent first.
 * @param now - "Today"; defaults to the current time.
 * @param startDate - Business start date (the first FY listed).
 * @returns Ordered list of FYs.
 */
export function listFinancialYears(
  now: Date = new Date(),
  startDate: Date = DEFAULT_START_DATE,
): FinancialYear[] {
  const firstStartYear = fyStartYear(startDate);
  const currentStartYear = fyStartYear(now);
  const fys: FinancialYear[] = [];
  for (let y = currentStartYear; y >= firstStartYear; y--) {
    fys.push(getFinancialYear(new Date(Date.UTC(y, APRIL, 1)), now, startDate));
  }
  return fys;
}

/**
 * Aggregated totals for a single financial year.
 */
export interface FinancialYearTotals {
  fy: FinancialYear;
  income: number;
  expensesExcl: number;
  gstClaimable: number;
  profit: number;
  taxReserve: number;
  incomeCount: number;
  expenseCount: number;
}

/**
 * Buckets income and expense entries into per-FY totals, returning one row
 * per FY the business has operated through (most-recent first).
 * @param income - Income entries with `amount` and `date`.
 * @param expenses - Expense entries with `amountExcl`, `gstAmount`, and `date`.
 * @param now - "Today"; defaults to the current time.
 * @param incomeTaxRate - Income-tax provision rate (fraction); defaults to 0.2.
 * @param startDate - Business start date (for the FY list + partial label).
 * @returns Per-FY totals, most recent first.
 */
export function aggregateByFinancialYear(
  income: ReadonlyArray<{ amount: number; date: Date }>,
  expenses: ReadonlyArray<{ amountExcl: number; gstAmount: number; date: Date }>,
  now: Date = new Date(),
  incomeTaxRate: number = 0.2,
  startDate: Date = DEFAULT_START_DATE,
): FinancialYearTotals[] {
  return listFinancialYears(now, startDate).map((fy) => {
    const fyIncome = income.filter((e) => e.date >= fy.start && e.date < fy.end);
    const fyExpenses = expenses.filter((e) => e.date >= fy.start && e.date < fy.end);
    const totalIncome = fyIncome.reduce((s, e) => s + e.amount, 0);
    const totalExpensesExcl = fyExpenses.reduce((s, e) => s + e.amountExcl, 0);
    const totalGstClaimable = fyExpenses.reduce((s, e) => s + e.gstAmount, 0);
    const profit = totalIncome - totalExpensesExcl;
    return {
      fy,
      income: totalIncome,
      expensesExcl: totalExpensesExcl,
      gstClaimable: totalGstClaimable,
      profit: Math.round(profit * 100) / 100,
      // Income-tax provision is on PROFIT, not raw income (matches the NZ
      // sole-trader Tax Planner sheet); the rate comes from the tax settings.
      // Negative profit yields zero reserve.
      taxReserve: Math.round(Math.max(0, profit * incomeTaxRate) * 100) / 100,
      incomeCount: fyIncome.length,
      expenseCount: fyExpenses.length,
    };
  });
}

/**
 * Extracts the `YYYY-YY` key from a financial-year label ("FY 2025-26").
 * The ledger filters store the key, while {@link FinancialYear} carries the
 * display label, so the two need converting at the boundary.
 * @param label - The FY label.
 * @returns The key, or the label unchanged when it doesn't match.
 */
export function fyKeyOf(label: string): string {
  return label.match(/(\d{4}-\d{2})/)?.[1] ?? label;
}
