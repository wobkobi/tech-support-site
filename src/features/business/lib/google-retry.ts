// src/features/business/lib/google-retry.ts
// Retry wrapper for googleapis calls. Transient failures (rate limits, 5xx,
// connection resets) are retried with exponential backoff plus a small additive
// jitter; permanent errors (bad range, auth, protected range) are rethrown
// immediately.

/** HTTP statuses worth retrying: rate limit + server-side hiccups. */
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Node network error codes worth retrying. */
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
]);

export interface RetryOpts {
  /** Retry attempts after the first try (default 4). */
  retries?: number;
  /** Base backoff in ms; doubles each attempt (default 400). */
  baseMs?: number;
  /** Label used in the retry warning log. */
  label?: string;
}

/**
 * Extracts the HTTP status from a GaxiosError-shaped error. googleapis sets
 * both a numeric `code` and `response.status` depending on the failure path.
 * @param err - The thrown error.
 * @returns HTTP status number, or null when not an HTTP error.
 */
function httpStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { code?: unknown; response?: { status?: unknown } };
  if (typeof e.response?.status === "number") return e.response.status;
  if (typeof e.code === "number") return e.code;
  return null;
}

/**
 * Determines whether an error is transient and safe to retry.
 * @param err - The thrown error.
 * @returns True when a retry has a chance of succeeding.
 */
function isTransient(err: unknown): boolean {
  const status = httpStatus(err);
  if (status !== null) return TRANSIENT_STATUSES.has(status);
  if (typeof err === "object" && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return TRANSIENT_CODES.has(code);
  }
  return false;
}

/**
 * Reads a Retry-After response header (seconds) when Google supplies one on 429s.
 * @param err - The thrown error.
 * @returns Milliseconds to wait, or null when absent/unparseable.
 */
function retryAfterMs(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const headers = (err as { response?: { headers?: Record<string, unknown> } }).response?.headers;
  const raw = headers?.["retry-after"];
  const secs = typeof raw === "string" ? parseFloat(raw) : typeof raw === "number" ? raw : NaN;
  return Number.isFinite(secs) && secs > 0 ? secs * 1000 : null;
}

/**
 * Runs a googleapis call, retrying transient failures with exponential backoff
 * plus a small additive jitter. Honours Retry-After on 429s. Wrap the individual API call,
 * not a multi-step function, so a retry re-issues only the failed request.
 * @param fn - Thunk performing one API call.
 * @param opts - Retry tuning; see {@link RetryOpts}.
 * @returns The call's result.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const { retries = 4, baseMs = 400, label = "google" } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isTransient(err)) throw err;
      const backoff = baseMs * 2 ** attempt + Math.random() * 250;
      const delay = Math.max(backoff, retryAfterMs(err) ?? 0);
      console.warn(
        `[${label}] transient error (attempt ${attempt + 1}/${retries + 1}), retrying in ${Math.round(delay)}ms:`,
        httpStatus(err) ?? (err as { code?: unknown })?.code ?? String(err),
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
