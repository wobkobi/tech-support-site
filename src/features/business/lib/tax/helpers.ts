// src/features/business/lib/tax/helpers.ts
// Small rounding, percentage and ledger-date helpers the tax modules share.

import type { TaxFy } from "@/features/business/lib/tax/types";
import { nzDayStartUtc } from "@/shared/lib/timezone-utils";

// Re-exported so the tax modules keep one import line for their small helpers.
export { roundCents } from "@/shared/lib/money";

/**
 * Rounds a distance to 0.1 km so summed float trips don't leave 0.30000000004 tails.
 * @param km - Distance.
 * @returns Distance to one decimal place.
 */
export function roundKm(km: number): number {
  return Math.round(km * 10) / 10;
}

/**
 * Turns a 0-100 percentage into a clamped 0-1 fraction; non-finite counts as 100.
 * @param pct - Percentage, normally 0-100.
 * @returns Fraction between 0 and 1.
 */
export function pctFraction(pct: number): number {
  if (!Number.isFinite(pct)) return 1;
  return Math.min(100, Math.max(0, pct)) / 100;
}

/**
 * Puts a date on the ledger scale: UTC midnight of its NZ calendar day (ledger dates pass unchanged).
 * @param date - ISO string or Date.
 * @returns UTC midnight of the NZ day.
 */
export function ledgerDay(date: string | Date): Date {
  return nzDayStartUtc(typeof date === "string" ? new Date(date) : date);
}

/**
 * Half-open FY window test on normalised ISO strings, matching filterByScope.
 * @param date - ISO string or Date.
 * @param fy - The financial year (only its bounds are read).
 * @returns True when start <= date < end.
 */
export function inFy(date: string | Date, fy: Pick<TaxFy, "start" | "end">): boolean {
  const iso = (typeof date === "string" ? new Date(date) : date).toISOString();
  return iso >= fy.start.toISOString() && iso < fy.end.toISOString();
}
