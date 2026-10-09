// src/shared/lib/api-response.ts
// Shared JSON response helpers so every API route returns a consistent `{ ok, ... }`
// shape, letting clients branch on `ok` instead of guessing between `{ error }` and
// `{ ok: false, error }`. Also the no-store marker and the Prisma error checks routes use
// to pick a 404 or a retry.

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

/**
 * Builds a failed JSON response with a consistent `{ ok: false, error }` body.
 * Generic in the response payload so it's assignable in handlers annotated with
 * a specific `NextResponse<T>` return type; `T` infers from the return context.
 * @param message - Human-readable error message returned to the client.
 * @param status - HTTP status code (defaults to 400).
 * @returns A {@link NextResponse} carrying the error body and status.
 */
export function errorResponse<T = never>(message: string, status = 400): NextResponse<T> {
  return NextResponse.json({ ok: false, error: message }, { status }) as NextResponse<T>;
}

/**
 * Builds a successful JSON response with a consistent `{ ok: true, ...data }`
 * body, mirroring {@link errorResponse} so clients branch on `ok`.
 * @param data - Payload object merged into the body alongside `ok: true`.
 * @param status - HTTP status code (defaults to 200).
 * @returns A {@link NextResponse} carrying the success body and status.
 */
export function okResponse(data: Record<string, unknown> = {}, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...data }, { status });
}

/**
 * Marks a response as never cacheable, for admin data that changes on every save.
 * @param res - Response to mark.
 * @returns The same response.
 */
export function noStore<T>(res: NextResponse<T>): NextResponse<T> {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * Whether an error is Prisma's known-request error with the given code.
 * @param err - Caught error.
 * @param code - Prisma error code, e.g. "P2002".
 * @returns True when the codes match.
 */
function isPrismaError(err: unknown, code: string): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}

/**
 * Whether an error is Prisma's unique-constraint violation (P2002), as when two first
 * saves race to create the same row.
 * @param err - Caught error.
 * @returns True for P2002.
 */
export function isUniqueConflict(err: unknown): boolean {
  return isPrismaError(err, "P2002");
}

/**
 * Whether an error is Prisma's "record to update or delete does not exist" (P2025): a
 * missing or stale id, which a route answers with 404 while rethrowing anything else.
 * @param err - Caught error.
 * @returns True for P2025.
 */
export function isRecordNotFound(err: unknown): boolean {
  return isPrismaError(err, "P2025");
}
