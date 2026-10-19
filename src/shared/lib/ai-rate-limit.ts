// src/shared/lib/ai-rate-limit.ts
// Turns an OpenAI or Claude 429 into the shared AI route response, carrying the provider's
// reported wait so callers don't burn retries on blind backoff.

import { NextResponse } from "next/server";

/** Longest wait passed on to a caller; beyond this, retrying is the wrong move. */
const MAX_RETRY_AFTER_MS = 180_000;

/**
 * Parses OpenAI's chained duration strings ("2m46.98s", "30.554s", "120ms") into milliseconds.
 * @param value - Header value such as "2m46.98s".
 * @returns Milliseconds, or null when nothing parseable is present.
 */
export function parseOpenAiDuration(value: string): number | null {
  const parts = value.matchAll(/(\d+(?:\.\d+)?)\s*(ms|s|m|h)/gi);
  const perUnit: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  let total = 0;
  let matched = false;
  for (const match of parts) {
    const amount = match[1];
    const unit = match[2];
    if (amount === undefined || unit === undefined) continue;
    total += Number(amount) * (perUnit[unit.toLowerCase()] ?? 0);
    matched = true;
  }
  return matched ? Math.round(total) : null;
}

/**
 * Reads a header from a `Headers` instance or a plain record; the SDKs have used both.
 * @param headers - Header collection from the SDK error.
 * @param name - Header name, lowercase.
 * @returns The value, or null when absent.
 */
function header(headers: unknown, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name);
  }
  const record = headers as Record<string, string | undefined>;
  return record[name] ?? null;
}

/**
 * How long to wait before retrying. Prefers retry-after, then OpenAI's token-window reset,
 * since one parse-job call uses a large share of the per-minute token budget.
 * @param headers - Headers from the provider's rate-limit error.
 * @returns Milliseconds to wait, capped, or null when nothing usable is present.
 */
export function aiRetryAfterMs(headers: unknown): number | null {
  const ms = header(headers, "retry-after-ms");
  if (ms && Number.isFinite(Number(ms))) return Math.min(Number(ms), MAX_RETRY_AFTER_MS);

  const seconds = header(headers, "retry-after");
  if (seconds && Number.isFinite(Number(seconds))) {
    return Math.min(Number(seconds) * 1000, MAX_RETRY_AFTER_MS);
  }

  for (const name of ["x-ratelimit-reset-tokens", "x-ratelimit-reset-requests"]) {
    const raw = header(headers, name);
    const parsed = raw ? parseOpenAiDuration(raw) : null;
    if (parsed !== null && parsed > 0) return Math.min(parsed, MAX_RETRY_AFTER_MS);
  }
  return null;
}

/**
 * Builds the 429 response for an upstream rate limit, with `retryable` and `retryAfterMs`.
 * Typed by its one field, as the SDK's error class isn't usable as a type.
 * @param err - The provider's rate-limit error, for its response headers.
 * @param err.headers - Response headers carrying the reset hints.
 * @returns A 429 JSON response carrying the retry hint when one is available.
 */
export function aiRateLimitResponse(err: { headers?: unknown }): NextResponse {
  const retryAfterMs = aiRetryAfterMs(err.headers);
  return NextResponse.json(
    {
      ok: false,
      error: "AI rate limited - try again shortly",
      retryable: true,
      ...(retryAfterMs !== null && { retryAfterMs }),
    },
    {
      status: 429,
      ...(retryAfterMs !== null && {
        headers: { "retry-after": String(Math.ceil(retryAfterMs / 1000)) },
      }),
    },
  );
}
