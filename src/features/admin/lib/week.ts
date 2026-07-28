// src/features/admin/lib/week.ts
/**
 * @description Week-range helpers for the admin schedule view.
 */

import { nzDateParts, nzMidnightUtc } from "@/shared/lib/timezone-utils";

/**
 * Parses a YYYY-MM-DD week-start string into a UTC Date representing NZ midnight,
 * or computes the Monday of the current NZ week when no string is provided.
 * @param weekStartParam - Optional YYYY-MM-DD string for the requested week start.
 * @param now - Current time reference (used when computing the default).
 * @returns UTC Date corresponding to NZ midnight at the start of the chosen week.
 */
export function resolveWeekStart(weekStartParam: string | undefined, now: Date): Date {
  if (weekStartParam && /^\d{4}-\d{2}-\d{2}$/.test(weekStartParam)) {
    const [y, m, d] = weekStartParam.split("-").map(Number);
    return nzMidnightUtc(y, m, d);
  }

  // Default: Monday of the current NZ week.
  const [y, m, d] = nzDateParts(now);

  // JS Date.UTC handles month/day overflow; getUTCDay on noon-UTC gives the
  // right NZ wall-clock day for the offset-shifted construction.
  const nzNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dow = nzNoon.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const offsetToMonday = (dow + 6) % 7; // Mon=0, Tue=1, ..., Sun=6

  return nzMidnightUtc(y, m, d - offsetToMonday);
}

/**
 * Adds days to a UTC Date while keeping the wall-clock time stable across DST.
 * @param date - Source UTC Date.
 * @param days - Number of days to add (negative to go back).
 * @returns Shifted UTC Date.
 */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
