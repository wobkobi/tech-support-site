// src/shared/lib/openai-rate-limit.ts
// Turns an OpenAI 429 into the route response both AI routes return, carrying
// the wait OpenAI itself reported. Without that figure a caller can only guess,
// and a blind exponential backoff spends its early retries failing again: the
// tokens-per-minute window resets on a clock OpenAI knows and we do not.

import { NextResponse } from "next/server";

/** Longest wait passed on to a caller; beyond this, retrying is the wrong move. */
const MAX_RETRY_AFTER_MS = 180_000;

/**
 * Parses OpenAI's compound duration strings into milliseconds.
 *
 * The rate-limit reset headers are written for humans, not machines:
 * "2m46.98s", "30.554s", "120ms". Units may be chained and fractional, so this
 * sums every unit present rather than matching one shape.
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
 * Reads one header from either a `Headers` instance or a plain record, since
 * the OpenAI SDK has used both shapes.
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
 * Extracts how long to wait before retrying a rate-limited OpenAI call.
 *
 * Prefers the explicit retry hints, then falls back to the token-window reset -
 * on this account the tokens-per-minute budget is what actually runs out, since
 * one parse-job call requests a large share of it.
 * @param headers - Headers from the OpenAI rate-limit error.
 * @returns Milliseconds to wait, capped, or null when nothing usable is present.
 */
export function openAiRetryAfterMs(headers: unknown): number | null {
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
 * Builds the 429 response both AI routes return for an upstream rate limit.
 *
 * `retryable` tells a caller the failure is transient rather than a bad
 * request; `retryAfterMs` tells it how long to wait, so it need not guess.
 * Typed by the one field it reads rather than by the SDK's error class, which
 * is a value and not usable as a type here.
 * @param err - The OpenAI rate-limit error, for its response headers.
 * @param err.headers - Response headers carrying the reset hints.
 * @returns A 429 JSON response carrying the retry hint when one is available.
 */
export function openAiRateLimitResponse(err: { headers?: unknown }): NextResponse {
  const retryAfterMs = openAiRetryAfterMs(err.headers);
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
