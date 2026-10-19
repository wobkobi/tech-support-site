// src/features/business/lib/monthly.ts
// NZ calendar-month bucketing for the admin charts, via nzDateParts (agrees with the
// `>= nzMidnightUtc(y, m, 1)` month filters the pages use).

import { roundCents } from "@/shared/lib/money";
import { nzDateParts } from "@/shared/lib/timezone-utils";

/** One NZ calendar month. */
export interface NzMonth {
  /** "YYYY-MM", e.g. "2026-04". */
  key: string;
  /** Full year. */
  year: number;
  /** Month 1-12. */
  month: number;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * Builds a month, wrapping overflow (month 13 > next January, month 0 > previous December).
 * @param year - Full year.
 * @param month - Month, 1-12 or overflowing either way.
 * @returns The normalised month.
 */
export function nzMonth(year: number, month: number): NzMonth {
  const index = year * 12 + (month - 1);
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  return { key: `${y}-${String(m).padStart(2, "0")}`, year: y, month: m };
}

/**
 * The NZ calendar month containing an instant or ledger date (UTC midnight is midday or 1pm
 * NZ, so ledger dates never slip a month).
 * @param date - A Date or an ISO string.
 * @returns The month it falls in.
 */
export function nzMonthOf(date: Date | string): NzMonth {
  const [year, month] = nzDateParts(typeof date === "string" ? new Date(date) : date);
  return nzMonth(year, month);
}

/**
 * Consecutive months ending with `last`, oldest first.
 * @param last - The final month.
 * @param count - How many months.
 * @returns The months.
 */
export function nzMonthsEnding(last: NzMonth, count: number): NzMonth[] {
  return Array.from({ length: count }, (_, i) => nzMonth(last.year, last.month - (count - 1 - i)));
}

/**
 * Every month from `first` through `last` inclusive, oldest first.
 * @param first - The first month.
 * @param last - The last month.
 * @returns The months, or an empty list when `last` comes before `first`.
 */
export function nzMonthSpan(first: NzMonth, last: NzMonth): NzMonth[] {
  const count = (last.year - first.year) * 12 + (last.month - first.month) + 1;
  return count > 0 ? nzMonthsEnding(last, count) : [];
}

/** Keys of `T` whose values are assignable to `V`. */
type KeysOfType<T, V> = { [K in keyof T]-?: T[K] extends V ? K : never }[keyof T];

/**
 * Sums each row's amount into its NZ month, ignoring rows outside `months`; totals rounded to cents.
 * @param rows - Rows to bucket.
 * @param fields - Which row fields to read.
 * @param fields.date - Field holding the row's date (a Date or an ISO string).
 * @param fields.amount - Field holding the row's amount in dollars.
 * @param months - The months to fill, in display order.
 * @param monthOf - Maps a row date to its month; defaults to {@link nzMonthOf}.
 * @returns One total per month, aligned with `months`.
 */
export function bucketByNzMonth<T>(
  rows: readonly T[],
  fields: { date: KeysOfType<T, Date | string>; amount: KeysOfType<T, number> },
  months: readonly NzMonth[],
  monthOf: (date: Date | string) => NzMonth = nzMonthOf,
): number[] {
  const slot = new Map(months.map((m, i) => [m.key, i]));
  const totals = months.map(() => 0);
  for (const row of rows) {
    const i = slot.get(monthOf(row[fields.date] as Date | string).key);
    if (i !== undefined) totals[i] = (totals[i] ?? 0) + (row[fields.amount] as number);
  }
  return totals.map((t) => roundCents(t));
}

/**
 * Three-letter axis label, e.g. "Oct".
 * @param m - The month.
 * @returns The short name.
 */
export function nzMonthShortLabel(m: NzMonth): string {
  return (MONTH_NAMES[m.month - 1] ?? "").slice(0, 3);
}

/**
 * Full label for tooltips and tables, e.g. "October 2026".
 * @param m - The month.
 * @returns The month name and year.
 */
export function nzMonthLongLabel(m: NzMonth): string {
  return `${MONTH_NAMES[m.month - 1] ?? ""} ${m.year}`;
}
