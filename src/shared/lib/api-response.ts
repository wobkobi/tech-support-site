// src/shared/lib/api-response.ts
// JSON response helpers for a consistent `{ ok, ... }` shape, plus no-store and Prisma error checks.

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

/**
 * Builds a `{ ok: false, error }` response. Generic so it fits handlers typed `NextResponse<T>`.
 * @param message - Human-readable error message returned to the client.
 * @param status - HTTP status code (defaults to 400).
 * @returns A {@link NextResponse} carrying the error body and status.
 */
export function errorResponse<T = never>(message: string, status = 400): NextResponse<T> {
  return NextResponse.json({ ok: false, error: message }, { status }) as NextResponse<T>;
}

/**
 * Builds a `{ ok: true, ...data }` response, mirroring {@link errorResponse}.
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
 * Whether an error is Prisma's unique-constraint violation (P2002), as when first saves race.
 * @param err - Caught error.
 * @returns True for P2002.
 */
export function isUniqueConflict(err: unknown): boolean {
  return isPrismaError(err, "P2002");
}

/**
 * Whether an error is Prisma's missing-record P2025, which routes answer with 404.
 * @param err - Caught error.
 * @returns True for P2025.
 */
export function isRecordNotFound(err: unknown): boolean {
  return isPrismaError(err, "P2025");
}
