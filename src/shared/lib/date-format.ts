// src/shared/lib/date-format.ts
// Canonical NZ date/time formatters (Pacific/Auckland for clocked outputs), plus the
// spreadsheet-cell and YYYY-MM-DD date-key parsers.

import { NZ_TZ } from "@/shared/lib/timezone-utils";

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

/**
 * Parses a spreadsheet date cell into a Date.
 *
 * Sheets carry NZ day-first slashes ("7/9/2026" is 7 September), which the
 * Date constructor reads month-first, so those are rewritten to ISO before
 * parsing. Anything else is handed to the constructor as-is.
 * @param raw - Cell text.
 * @returns The parsed date, or null when it is not a date at all.
 */
export function parseSheetDate(raw: string): Date | null {
  const t = raw.trim();
  const dmy = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const value = dmy
    ? `${dmy[3]}-${(dmy[2] ?? "").padStart(2, "0")}-${(dmy[1] ?? "").padStart(2, "0")}`
    : t;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** "YYYY-MM-DD", the date-key shape `<input type="date">` sends. */
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a "YYYY-MM-DD" date key to UTC midnight of that day, the scale ledger dates are
 * stored on. Surrounding whitespace is ignored. The round trip through toISOString
 * refuses days the calendar doesn't have: the Date constructor would roll 2026-02-30
 * forward into March.
 * @param value - Raw value, e.g. from a request body or a settings field.
 * @returns The date, or null when the value isn't a real YYYY-MM-DD day.
 */
export function parseDateKey(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (!DATE_KEY_RE.test(key)) return null;
  const date = new Date(`${key}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === key ? date : null;
}
