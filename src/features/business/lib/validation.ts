/**
 * @file validation.ts
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
