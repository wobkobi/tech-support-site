/**
 * @description Shared input parsers for business write routes.
 * Reject non-finite, out-of-range, or otherwise nonsensical numeric values
 * before they reach Prisma so accounting reports stay coherent.
 */

const MAX_AMOUNT = 1_000_000_000;

/**
 * Parses a money amount from arbitrary input. Accepts a finite, non-negative
 * number or numeric string up to 1,000,000,000.
 * @param value - Raw value from a request body.
 * @returns The numeric amount, or null if invalid.
 */
export function parseAmount(value: unknown): number | null {
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

/** MongoDB ObjectId hex shape, the only string Prisma accepts for a `@db.ObjectId` field. */
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

/**
 * Parses a foreign key bound for a `@db.ObjectId` column. Prisma throws on a
 * malformed id rather than storing it, so an unchecked value from a request
 * body 500s the write instead of failing as a 400.
 * @param value - Raw value from a request body.
 * @returns The id, or null when it isn't a 24-character hex ObjectId.
 */
export function parseObjectId(value: unknown): string | null {
  return typeof value === "string" && OBJECT_ID_RE.test(value) ? value : null;
}

/**
 * Parses a date from a request body. Rejects the empty string a cleared
 * `<input type="date">` submits, which `new Date("")` turns into an Invalid
 * Date - Prisma rejects that outright ("Provided Date object is invalid"), so
 * passing it through 500s the write.
 * @param value - Raw value from a request body.
 * @returns The parsed date, or null when the value is missing or unparseable.
 */
export function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
