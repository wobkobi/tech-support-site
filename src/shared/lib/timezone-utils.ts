// src/shared/lib/timezone-utils.ts
/**
 * @description Timezone utility functions for Pacific/Auckland timezone calculations.
 */

/**
 * Adds `n` days to a YYYY-MM-DD key. Uses UTC noon so a DST transition can't roll
 * the date part backwards, then keeps just the date. Timezone-agnostic - operates
 * purely on the calendar-date string (as used for all-day event date keys).
 * @param dateKey - The base day (YYYY-MM-DD).
 * @param n - Days to add (may be negative).
 * @returns The shifted YYYY-MM-DD key.
 */
export function addDaysToDateKey(dateKey: string, n: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12, 0, 0)).toISOString().slice(0, 10);
}

/**
 * UTC offset (hours) for Pacific/Auckland on a given date.
 * Handles NZDT (UTC+13, Sep-Apr) and NZST (UTC+12, Apr-Sep) automatically.
 * @param year - Full year.
 * @param month - Month 1-12 (not 0-indexed).
 * @param day - Day of month.
 * @returns Offset in hours (12 or 13).
 */
export function getPacificAucklandOffset(year: number, month: number, day: number): number {
  // Take the NZ wall-clock hour at UTC midnight; since UTC is at hour 0,
  // that hour equals the offset directly. This sidesteps Intl DST APIs.
  const utcMidnight = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const nzHour = parseInt(
    utcMidnight.toLocaleString("en-US", {
      timeZone: "Pacific/Auckland",
      hour: "numeric",
      hour12: false,
    }),
    10,
  );
  return nzHour;
}
