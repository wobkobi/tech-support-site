// src/features/business/lib/financial-year.ts
// NZ financial year (1 April - 31 March) bucketing, named by start year: Apr 2025 - Mar 2026
// is "FY 2025-26".

import { nzDayStartUtc } from "@/shared/lib/timezone-utils";

/** Index of April in JS Date (0 = January): the first month of an NZ FY. */
export const APRIL = 3;

/** One day in ms, for stepping across a ledger date or an FY's exclusive end. */
export const DAY_MS = 86_400_000;

/** Fallback business start; the live value is `identity.startDateIso` from the callers. */
const DEFAULT_START_DATE = new Date("2025-10-01T00:00:00Z");

/**
 * Start year of the NZ FY containing `date`. Reads UTC parts after {@link nzDayStartUtc},
 * whose UTC day is the NZ day.
 * @param date - Any date.
 * @returns Start year (e.g. 2025 for any date in Apr 2025 - Mar 2026).
 */
function fyStartYear(date: Date): number {
  const d = nzDayStartUtc(date);
  const m = d.getUTCMonth();
  const y = d.getUTCFullYear();
  return m >= APRIL ? y : y - 1;
}

/** One NZ financial year: display label and bucketing bounds. */
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
 * Lists every FY from the business start through the current FY, most recent first.
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
 * Extracts the `YYYY-YY` key the ledger filters store from a {@link FinancialYear} label ("FY 2025-26").
 * @param label - The FY label.
 * @returns The key, or the label unchanged when it doesn't match.
 */
export function fyKeyOf(label: string): string {
  return label.match(/(\d{4}-\d{2})/)?.[1] ?? label;
}

/**
 * The NZ FY code an invoice or quote number carries, e.g. "202627" for the year from 1 April 2026.
 * Reads the NZ month: Vercel runs on UTC, which still says March for half of NZ 1 April.
 * @param now - Reference instant (defaults to the current time).
 * @returns Six-digit financial-year code.
 */
export function nzFinancialYearCode(now: Date = new Date()): string {
  const startYear = fyStartYear(now);
  return String(startYear) + String(startYear + 1).slice(2);
}
