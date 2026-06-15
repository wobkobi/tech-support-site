// src/shared/lib/api-response.ts
/**
 * @file api-response.ts
 * @description Shared JSON response helpers so every API route returns a
 * consistent discriminated shape. Errors are always `{ ok: false, error }` and
 * successes always carry `ok: true`, so clients branch on `ok` instead of
 * guessing between `{ error }` and `{ ok: false, error }`.
 */

import { NextResponse } from "next/server";

/**
 * Builds a failed JSON response with a consistent `{ ok: false, error }` body.
 * @param message - Human-readable error message returned to the client.
 * @param status - HTTP status code (defaults to 400).
 * @returns A {@link NextResponse} carrying the error body and status.
 */
export function errorResponse(message: string, status = 400): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Builds a successful JSON response. Any extra payload is spread alongside the
 * `ok: true` flag, e.g. `okResponse({ contacts })` > `{ ok: true, contacts }`.
 * @param data - Optional payload object merged into the response body.
 * @param status - HTTP status code (defaults to 200).
 * @returns A {@link NextResponse} carrying `ok: true` plus any payload.
 */
export function okResponse(data?: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...(data ?? {}) }, { status });
}
