// src/shared/lib/rate-limit.ts
// In-memory fixed-window rate limiter for public POST routes. Per-instance, so the real limit is
// about N_instances x limit; fine at this traffic.

import { NextRequest, NextResponse } from "next/server";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

/**
 * Records a hit and reports whether it is allowed, in a fixed window started by the first hit.
 * @param key - Bucket identifier (typically `route:ip`).
 * @param limit - Maximum allowed hits within the window.
 * @param windowMs - Window length in milliseconds.
 * @returns Object with `allowed` and the `retryAfterMs` when blocked.
 */
function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count++;

  // Opportunistic cleanup so an unbounded burst of unique IPs cannot leak memory.
  if (buckets.size > MAX_BUCKETS) {
    for (const [k, v] of buckets) {
      if (v.resetAt <= now) buckets.delete(k);
    }
  }

  if (bucket.count > limit) {
    return { allowed: false, retryAfterMs: Math.max(0, bucket.resetAt - now) };
  }
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Client IP from the first `x-forwarded-for` entry, then `x-real-ip`, else "unknown".
 * @param request - Incoming request.
 * @returns Client IP string.
 */
export function getClientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Outside production only, a matching admin secret skips rate limiting for the eval harness.
 * @param nodeEnv - `process.env.NODE_ENV`.
 * @param headerSecret - The request's `x-admin-secret` header value (or null).
 * @param adminSecret - `process.env.ADMIN_SECRET` (or undefined when unset).
 * @returns True only when non-production and the secrets match.
 */
function isRateLimitBypassed(
  nodeEnv: string | undefined,
  headerSecret: string | null,
  adminSecret: string | undefined,
): boolean {
  if (nodeEnv === "production") return false;
  if (!adminSecret) return false;
  return headerSecret === adminSecret;
}

/**
 * Runs {@link rateLimit}; returns a 429 with `Retry-After` when blocked, else null.
 * @param request - Incoming request used to derive the client IP.
 * @param scope - Short identifier for the route (combined with IP into the bucket key).
 * @param limit - Maximum allowed hits within the window.
 * @param windowMs - Window length in milliseconds.
 * @returns A 429 NextResponse when blocked, or null when allowed.
 */
export function rateLimitOrReject(
  request: NextRequest,
  scope: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  // Non-prod eval harness batches the public route; let it skip the limit when
  // it presents the admin secret. Never fires in production.
  if (
    isRateLimitBypassed(
      process.env.NODE_ENV,
      request.headers.get("x-admin-secret"),
      process.env.ADMIN_SECRET,
    )
  ) {
    return null;
  }

  const ip = getClientIp(request);
  const { allowed, retryAfterMs } = rateLimit(`${scope}:${ip}`, limit, windowMs);
  if (allowed) return null;
  return NextResponse.json(
    { error: "Too many requests. Please try again shortly." },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
    },
  );
}
