// src/shared/lib/date-format.ts
/**
 * @file date-format.ts
 * @description Canonical NZ date/time formatters (Pacific/Auckland for clocked outputs).
 */

const NZ_TZ = "Pacific/Auckland";

/**
 * Coerces a Date or ISO string into a Date instance.
 * @param input - Date object or ISO 8601 string.
 * @returns Date instance.
 */
function toDate(input: Date | string): Date {
  return typeof input === "string" ? new Date(input) : input;
}

/**
 * Short NZ date "11 May 2026".
 * @param input - Date or ISO string.
 * @returns Formatted string.
 */
export function formatDateShort(input: Date | string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(toDate(input));
}

/**
 * Compact NZ date + time "Mon 11 May, 2:30 pm".
 * @param input - Date or ISO string.
 * @returns Formatted string.
 */
export function formatDateTimeShort(input: Date | string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: NZ_TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(toDate(input));
}

/**
 * Long NZ date + time "Monday, 11 May 2026 at 2:30 pm" - used in emails.
 * @param input - Date or ISO string.
 * @returns Formatted string.
 */
export function formatDateTimeLong(input: Date | string): string {
  return toDate(input).toLocaleString("en-NZ", {
    timeZone: NZ_TZ,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Slash date "DD/MM/YYYY" for sheet columns.
 * @param input - Date or ISO string.
 * @param opts - Optional flags.
 * @param opts.utc - When true, uses UTC date parts (sheet rows are UTC).
 * @returns Formatted string.
 */
export function formatDateSlash(input: Date | string, opts: { utc?: boolean } = {}): string {
  const d = toDate(input);
  const get = opts.utc
    ? { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() }
    : { day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() };
  const day = String(get.day).padStart(2, "0");
  const month = String(get.month).padStart(2, "0");
  return `${day}/${month}/${get.year}`;
}
