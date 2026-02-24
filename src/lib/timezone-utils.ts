// src/lib/timezone-utils.ts
/**
 * @file timezone-utils.ts
 * @description Timezone utility functions for Pacific/Auckland timezone calculations.
 */

/**
 * Get the UTC offset for Pacific/Auckland timezone on a specific date.
 * Automatically handles NZDT (UTC+13, Sep–Apr) and NZST (UTC+12, Apr–Sep).
 *
 * @param year - Full year (e.g., 2026)
 * @param month - Month as 1-12 (not 0-indexed)
 * @param day - Day of month
 * @returns UTC offset in hours (13 during NZDT, 12 during NZST)
 */
export function getPacificAucklandOffset(year: number, month: number, day: number): number {
  // Create a date at midnight UTC on the target day
  const utcMidnight = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));

  // See what hour it is in NZ when it's midnight UTC
  const nzHour = parseInt(
    utcMidnight.toLocaleString("en-US", {
      timeZone: "Pacific/Auckland",
      hour: "numeric",
      hour12: false,
    }),
    10,
  );

  // The NZ hour IS the offset (since UTC is at hour 0)
  return nzHour;
}
