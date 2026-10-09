// src/features/business/lib/tax/helpers.ts
// Small rounding, percentage and ledger-date helpers the tax modules share.

import type { TaxFy } from "@/features/business/lib/tax/types";
import { nzDayStartUtc } from "@/shared/lib/timezone-utils";

/**
 * Rounds a dollar figure to cents.
 * @param n - Amount in dollars.
 * @returns The amount rounded to the nearest cent.
 */
export function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Turns a 0-100 percentage into a 0-1 fraction, clamped. A non-finite value
 * counts as 100 so a bad stored figure never silently zeroes a deduction.
 * @param pct - Percentage, normally 0-100.
 * @returns Fraction between 0 and 1.
 */
export function pctFraction(pct: number): number {
  if (!Number.isFinite(pct)) return 1;
  return Math.min(100, Math.max(0, pct)) / 100;
}

/**
 * Puts a date on the ledger scale: UTC midnight of its NZ calendar day. A stored
 * ledger date comes back unchanged; a real instant (11:30pm NZ, say) lands on
 * the NZ day it happened.
 * @param date - ISO string or Date.
 * @returns UTC midnight of the NZ day.
 */
export function ledgerDay(date: string | Date): Date {
  return nzDayStartUtc(typeof date === "string" ? new Date(date) : date);
}

/**
 * Half-open FY window test on ISO strings, matching the business page's
 * filterByScope. The date is normalised through Date first so a bare
 * "2026-04-01" compares as "2026-04-01T00:00:00.000Z".
 * @param date - ISO string or Date.
 * @param fy - The financial year.
 * @returns True when start <= date < end.
 */
export function inFy(date: string | Date, fy: TaxFy): boolean {
  const iso = (typeof date === "string" ? new Date(date) : date).toISOString();
  return iso >= fy.start.toISOString() && iso < fy.end.toISOString();
}
