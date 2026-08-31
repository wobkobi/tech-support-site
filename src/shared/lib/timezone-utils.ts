// src/shared/lib/timezone-utils.ts
/**
 * @description Timezone utility functions for Pacific/Auckland timezone calculations.
 */

/** The one NZ timezone name. Exported so nothing has to hardcode the literal. */
export const NZ_TZ = "Pacific/Auckland";

// Built once and reused: constructing an Intl.DateTimeFormat is the expensive
// part, .format() is cheap, and the schedule views call this per event.
// en-CA reliably yields YYYY-MM-DD on every Node.js platform.
const nzDateKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: NZ_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Same deal, with the time parts a datetime-local input needs.
const nzInputFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: NZ_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
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
 * Collapses an instant to the UTC midnight of its NZ calendar day.
 *
 * This is the scale ledger entries are stored on: a "2026-04-01" date string
 * parses as 2026-04-01T00:00:00Z, so a stored date is UTC midnight of an NZ
 * day rather than a real NZ instant. Bucketing or comparing an instant against
 * those rows has to put both on this scale first. Distinct from
 * {@link nzMidnightUtc}, which returns the true instant of NZ midnight
 * (11:00/12:00Z the day before) and is for scheduling, not ledger dates.
 * @param instant - The instant to collapse.
 * @returns UTC midnight of that instant's NZ calendar day.
 */
export function nzDayStartUtc(instant: Date): Date {
  const [y, m, d] = nzDateParts(instant);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Formats an instant as the NZ-local "YYYY-MM-DDTHH:mm" string an
 * `<input type="datetime-local">` expects. The browser would render its own
 * local time, which is only NZ time by luck, and the server runs in UTC.
 * @param input - The instant to format.
 * @returns NZ-local datetime string.
 */
export function toNzInputValue(input: Date | string): string {
  const parts = nzInputFormat.formatToParts(typeof input === "string" ? new Date(input) : input);
  const map = new Map(parts.map((p) => [p.type, p.value]));
  return `${map.get("year")}-${map.get("month")}-${map.get("day")}T${map.get("hour")}:${map.get("minute")}`;
}

/**
 * Parses a NZ-local "YYYY-MM-DDTHH:mm" datetime-local value back into a UTC
 * Date, applying the NZDT/NZST offset in force on that calendar date.
 * Callers must reject an empty input first - a cleared field has no parts to
 * read and cannot be given a sensible instant.
 * @param local - Input value from a datetime-local field, read as NZ time.
 * @returns The equivalent UTC Date.
 */
export function fromNzInputValue(local: string): Date {
  const [datePart, timePart] = local.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hh, mm] = timePart.split(":").map(Number);
  const offset = getPacificAucklandOffset(y, m, d);
  return new Date(Date.UTC(y, m - 1, d, hh - offset, mm, 0));
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
  return nzWallClockUtc(year, month, day, 0, 0);
}

/**
 * An NZ wall-clock time on a calendar date, as the equivalent UTC instant:
 * "2pm on 3 March in Auckland" as a real moment. Every booking path needs this,
 * and assembling it inline is where the sign of the offset and the 0-indexed
 * month get fumbled.
 *
 * The offset is read at NZ midnight of that date, so on the two DST transition
 * days a 2-3am wall-clock time is ambiguous. Appointments do not run then, and
 * this matches what every caller already did.
 * @param year - Full year.
 * @param month - Month 1-12 (overflow wraps).
 * @param day - Day of month (overflow wraps).
 * @param hour - NZ wall-clock hour, 0-23.
 * @param minute - NZ wall-clock minute (defaults to 0).
 * @returns UTC Date for that NZ wall-clock moment.
 */
export function nzWallClockUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date {
  const offset = getPacificAucklandOffset(year, month, day);
  return new Date(Date.UTC(year, month - 1, day, hour - offset, minute, 0));
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
