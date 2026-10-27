// src/features/business/lib/validation.ts
// Shared input parsers for business write routes; reject bad values before they reach Prisma.

const MAX_AMOUNT = 1_000_000_000;

/**
 * Parses a finite, non-negative money amount up to 1,000,000,000. A blank, null or boolean
 * is refused rather than read as 0 (`Number(null)` and `Number("")` are both 0).
 * @param value - Raw value from a request body.
 * @returns The numeric amount, or null if invalid.
 */
export function parseAmount(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > MAX_AMOUNT) return null;
  return n;
}

/**
 * Parses a rate (e.g. GST). Accepts a finite number or numeric string in 0..1.
 * @param value - Raw value from a request body.
 * @returns The numeric rate, or null if invalid.
 */
export function parseRate(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 1) return null;
  return n;
}

/** Length ceiling for a body string; comfortably above any token or email this API accepts. */
const MAX_STRING_LEN = 200;

/**
 * Parses a plain string from a request body. Security guard: every body value reaching a
 * Prisma `where` must pass here, or `{"cancelToken":{"not":""}}` matches someone else's row.
 * @param value - Raw value from a request body.
 * @param maxLen - Longest accepted length (defaults to {@link MAX_STRING_LEN}).
 * @returns The trimmed string, or null when it isn't a non-empty string within `maxLen`.
 */
export function parseString(value: unknown, maxLen: number = MAX_STRING_LEN): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > maxLen) return null;
  return trimmed;
}

/** MongoDB ObjectId hex shape, the only string Prisma accepts for a `@db.ObjectId` field. */
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

/**
 * Parses a `@db.ObjectId` foreign key; Prisma throws (a 500) on a malformed id.
 * @param value - Raw value from a request body.
 * @returns The id, or null when it isn't a 24-character hex ObjectId.
 */
export function parseObjectId(value: unknown): string | null {
  return typeof value === "string" && OBJECT_ID_RE.test(value) ? value : null;
}

/**
 * Parses a date from a request body. Rejects a cleared date input's "", which becomes an
 * Invalid Date that Prisma 500s on.
 * @param value - Raw value from a request body.
 * @returns The parsed date, or null when the value is missing or unparseable.
 */
export function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
