// src/features/business/lib/ledger-chart.ts
// Bar groups for the income vs expenses charts on the dashboard and the business page:
// one group per NZ month, or one per financial year for the all-time view. Every row in
// scope lands in exactly one group, so a chart's totals equal the matching stat cards'.
// Income and expenses arrive already on the GST basis (basisIncomeRows, basisExpenseRows),
// the same figures the cards sum.

import type { BarGroup } from "@/features/admin/components/charts/BarChart";
import {
  fyKeyOf,
  getFinancialYear,
  type FinancialYear,
} from "@/features/business/lib/financial-year";
import {
  bucketByNzMonth,
  nzMonth,
  nzMonthLongLabel,
  nzMonthOf,
  nzMonthShortLabel,
  nzMonthSpan,
  type NzMonth,
} from "@/features/business/lib/monthly";
import { expenseTaxBasis, incomeTaxBasis } from "@/features/business/lib/tax/gst-basis";
import type { GstStatus } from "@/features/business/lib/tax/types";

/** Income and expense rows; dates as Date (from Prisma) or ISO strings (page payloads). */
export interface LedgerRows {
  /** Income on the GST basis (see {@link basisIncomeRows}), matching the income cards. */
  income: ReadonlyArray<{ date: Date | string; amount: number }>;
  /** Expenses on the GST basis (see {@link basisExpenseRows}), matching the expense cards. */
  expenses: ReadonlyArray<{ date: Date | string; amount: number }>;
}

/**
 * Expense rows on the GST basis for {@link LedgerRows}: GST-inclusive while not registered
 * (or dated before registration took effect), GST-exclusive once registered.
 * @param rows - Expense rows with both amounts.
 * @param gst - Registration status.
 * @returns One `{ date, amount }` per row, in the same order.
 */
export function basisExpenseRows(
  rows: ReadonlyArray<{ date: Date | string; amountIncl: number; amountExcl: number }>,
  gst: GstStatus,
): Array<{ date: Date | string; amount: number }> {
  return rows.map((r) => ({ date: r.date, amount: expenseTaxBasis(r, gst) }));
}

/**
 * Income rows on the GST basis for {@link LedgerRows}: the GST-inclusive amount as
 * received while not registered (or dated before registration took effect), with its GST
 * backed out to the cent once registered.
 * @param rows - Income rows (GST-inclusive amounts).
 * @param gst - Registration status.
 * @returns One `{ date, amount }` per row, in the same order, each keeping its own date.
 */
export function basisIncomeRows(
  rows: ReadonlyArray<{ date: Date | string; amount: number }>,
  gst: GstStatus,
): Array<{ date: Date | string; amount: number }> {
  return rows.map((r) => ({
    date: r.date,
    amount: incomeTaxBasis({ date: isoOf(r.date), amount: r.amount }, gst),
  }));
}

/** Suffix on the label of the period that is still running. */
const TO_DATE = " (to date)";

/**
 * ISO form of a row date, for string comparison against ISO window bounds.
 * @param date - Date or ISO string.
 * @returns ISO string.
 */
function isoOf(date: Date | string): string {
  return typeof date === "string" ? date : date.toISOString();
}

/**
 * One group per month, income then expenses.
 * @param rows - Ledger rows; rows outside `months` are ignored.
 * @param months - Months oldest first.
 * @param now - Reference instant; its month is labelled "to date".
 * @param monthOf - Maps a row date to its month; defaults to {@link nzMonthOf}.
 * @returns The groups.
 */
export function ledgerMonthGroups(
  rows: LedgerRows,
  months: readonly NzMonth[],
  now: Date,
  monthOf: (date: Date | string) => NzMonth = nzMonthOf,
): BarGroup[] {
  const income = bucketByNzMonth(rows.income, { date: "date", amount: "amount" }, months, monthOf);
  const expenses = bucketByNzMonth(
    rows.expenses,
    { date: "date", amount: "amount" },
    months,
    monthOf,
  );
  const nowKey = nzMonthOf(now).key;
  return months.map((m, i) => ({
    key: m.key,
    shortLabel: nzMonthShortLabel(m),
    label: nzMonthLongLabel(m) + (m.key === nowKey ? TO_DATE : ""),
    values: [income[i] ?? 0, expenses[i] ?? 0],
  }));
}

/**
 * Monthly groups for one financial year. The FY's 12 months are trimmed at the front to
 * the business start month and at the back to the current month, so a partial or running
 * year shows no empty run of months that couldn't have data - but the trim never passes
 * a month that holds a row, so nothing in scope drops off the chart.
 *
 * The page scopes rows with plain ISO comparisons against UTC-midnight 1 April bounds. A
 * row stamped with a real instant between NZ midnight and UTC midnight on 1 April (a
 * payment recorded at 9am that day) passes the closing FY's window yet sits in April NZ
 * time, so such rows are counted in the FY's last month, where the FY cards count them.
 * @param rows - Ledger rows already filtered to the FY.
 * @param fy - The FY window as ISO strings (start inclusive, end exclusive).
 * @param fy.startISO - First instant of the FY.
 * @param fy.endISO - First instant after the FY.
 * @param businessStart - Business start date.
 * @param now - Reference instant.
 * @returns The groups, oldest first.
 */
export function fyMonthGroups(
  rows: LedgerRows,
  fy: { startISO: string; endISO: string },
  businessStart: Date,
  now: Date,
): BarGroup[] {
  const fyFirst = nzMonthOf(fy.startISO);
  const afterFy = nzMonthOf(fy.endISO);
  const fyLast = nzMonth(afterFy.year, afterFy.month - 1);
  /**
   * NZ month of an in-scope row, held inside the FY (see the 1 April note above).
   * @param date - Row date.
   * @returns The month.
   */
  const monthInFy = (date: Date | string): NzMonth => {
    const m = nzMonthOf(date);
    return m.key > fyLast.key ? fyLast : m;
  };
  const rowKeys = [...rows.income, ...rows.expenses].map((r) => monthInFy(r.date).key).sort();
  const startKey = nzMonthOf(businessStart).key;
  const nowKey = nzMonthOf(now).key;
  // "YYYY-MM" keys sort chronologically, so plain string min/max picks the months.
  const firstRowKey = rowKeys[0] ?? startKey;
  const lastRowKey = rowKeys[rowKeys.length - 1] ?? nowKey;
  const firstKey = maxKey(fyFirst.key, firstRowKey < startKey ? firstRowKey : startKey);
  const lastKey = minKey(fyLast.key, lastRowKey > nowKey ? lastRowKey : nowKey);
  const months =
    firstKey <= lastKey
      ? nzMonthSpan(monthOfKey(firstKey), monthOfKey(lastKey))
      : nzMonthSpan(fyFirst, fyLast);
  return ledgerMonthGroups(rows, months, now, monthInFy);
}

/**
 * One group per financial year for the all-time view, oldest first. Starts from the
 * listed FYs and adds the FY of any row that falls outside them, so the groups always sum
 * to the all-time totals.
 * @param rows - Every ledger row.
 * @param listed - The FYs the business has run through (any order).
 * @param businessStart - Business start date, for FY labels.
 * @param now - Reference instant; the current FY is labelled "to date".
 * @returns The groups.
 */
export function fyTotalGroups(
  rows: LedgerRows,
  listed: readonly FinancialYear[],
  businessStart: Date,
  now: Date,
): BarGroup[] {
  const byStart = new Map(listed.map((fy) => [fy.start.toISOString(), fy]));
  for (const r of [...rows.income, ...rows.expenses]) {
    // Read the FY off the row's UTC day, the same scale as the ISO `inFy` windows below;
    // the NZ day of a real instant early on 1 April would name the next FY.
    const utcDay = new Date(`${isoOf(r.date).slice(0, 10)}T00:00:00.000Z`);
    const fy = getFinancialYear(utcDay, now, businessStart);
    if (!byStart.has(fy.start.toISOString())) byStart.set(fy.start.toISOString(), fy);
  }
  const fys = [...byStart.values()].sort((a, b) => a.start.getTime() - b.start.getTime());
  return fys.map((fy) => {
    const startISO = fy.start.toISOString();
    const endISO = fy.end.toISOString();
    /**
     * Whether a row date falls inside this FY.
     * @param date - Row date.
     * @returns True when inside.
     */
    const inFy = (date: Date | string): boolean => {
      const iso = isoOf(date);
      return iso >= startISO && iso < endISO;
    };
    const income = rows.income.filter((r) => inFy(r.date)).reduce((s, r) => s + r.amount, 0);
    const expenses = rows.expenses.filter((r) => inFy(r.date)).reduce((s, r) => s + r.amount, 0);
    const key = fyKeyOf(fy.label);
    return {
      key,
      shortLabel: key,
      label: fy.label + (fy.current ? TO_DATE : ""),
      values: [Math.round(income * 100) / 100, Math.round(expenses * 100) / 100],
    };
  });
}

/**
 * The later of two "YYYY-MM" keys.
 * @param a - A key.
 * @param b - A key.
 * @returns The later key.
 */
function maxKey(a: string, b: string): string {
  return a > b ? a : b;
}

/**
 * The earlier of two "YYYY-MM" keys.
 * @param a - A key.
 * @param b - A key.
 * @returns The earlier key.
 */
function minKey(a: string, b: string): string {
  return a < b ? a : b;
}

/**
 * Parses a "YYYY-MM" key back into a month.
 * @param key - The key.
 * @returns The month.
 */
function monthOfKey(key: string): NzMonth {
  const [y = NaN, m = NaN] = key.split("-").map(Number);
  return nzMonth(y, m);
}
