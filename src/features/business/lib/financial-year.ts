// src/features/business/lib/financial-year.ts
// NZ financial year (1 April - 31 March) bucketing for the business dashboard. The FY
// containing a date is named after the START year; e.g. dates in Apr 2025 - Mar 2026
// belong to "FY 2025-26".

import { nzDayStartUtc } from "@/shared/lib/timezone-utils";

/** Index of April in JS Date (0 = January): the first month of an NZ FY. */
export const APRIL = 3;

/** One day in ms, for stepping across a ledger date or an FY's exclusive end. */
export const DAY_MS = 86_400_000;

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
 * Extracts the `YYYY-YY` key from a financial-year label ("FY 2025-26").
 * The ledger filters store the key, while {@link FinancialYear} carries the
 * display label, so the two need converting at the boundary.
 * @param label - The FY label.
 * @returns The key, or the label unchanged when it doesn't match.
 */
export function fyKeyOf(label: string): string {
  return label.match(/(\d{4}-\d{2})/)?.[1] ?? label;
}

/**
 * The NZ financial-year code an invoice or quote number carries, e.g. "202627"
 * for the year beginning 1 April 2026.
 *
 * Reads the NZ calendar month rather than the runtime's. The server clock is
 * UTC on Vercel, which is 12-13 hours behind NZ, so for the first half of each
 * NZ 1 April a local-time read still says March - and a number minted then
 * would be filed under the financial year that had just ended.
 * @param now - Reference instant (defaults to the current time).
 * @returns Six-digit financial-year code.
 */
export function nzFinancialYearCode(now: Date = new Date()): string {
  const startYear = fyStartYear(now);
  return String(startYear) + String(startYear + 1).slice(2);
}
