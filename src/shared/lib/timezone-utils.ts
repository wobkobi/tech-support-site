// src/shared/lib/timezone-utils.ts
/**
 * @description Timezone utility functions for Pacific/Auckland timezone calculations.
 */

const NZ_TZ = "Pacific/Auckland";

// Built once and reused: constructing an Intl.DateTimeFormat is the expensive
// part, .format() is cheap, and the schedule views call this per event.
// en-CA reliably yields YYYY-MM-DD on every Node.js platform.
const nzDateKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: NZ_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Formats an instant as its NZ (Pacific/Auckland) calendar date.
 * The server runs in UTC, so reading local Date parts would land 12-13 hours off
 * and attribute an evening booking to the wrong day.
 * @param date - The instant to read.
 * @returns NZ calendar date as YYYY-MM-DD.
 */
export function nzDateKey(date: Date): string {
  return nzDateKeyFormat.format(date);
}

/**
 * Today's NZ calendar date.
 * @returns NZ calendar date as YYYY-MM-DD.
 */
export function nzTodayKey(): string {
  return nzDateKey(new Date());
}

/**
 * Splits an instant into its NZ calendar year, month and day.
 * @param date - The instant to read.
 * @returns Tuple of [year, month (1-12), day].
 */
export function nzDateParts(date: Date): [number, number, number] {
  const [y, m, d] = nzDateKey(date).split("-").map(Number);
  return [y, m, d];
}

/**
 * NZ midnight for a calendar date, returned as the equivalent UTC instant.
 * Building day/month boundaries from local Date parts would land on UTC midnight
 * (12-13h off NZ) and miscount "today" / "this month". Handles NZDT and NZST via
 * {@link getPacificAucklandOffset}.
 * @param year - Full year.
 * @param month - Month 1-12 (overflow wraps, e.g. month 13 > January next year).
 * @param day - Day of month (overflow wraps, e.g. day 32 > next month).
 * @returns UTC Date at NZ midnight of that date.
 */
export function nzMidnightUtc(year: number, month: number, day: number): Date {
  const offset = getPacificAucklandOffset(year, month, day);
  return new Date(Date.UTC(year, month - 1, day, -offset, 0, 0));
}

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
      timeZone: NZ_TZ,
      hour: "numeric",
      hour12: false,
    }),
    10,
  );
  return nzHour;
}
