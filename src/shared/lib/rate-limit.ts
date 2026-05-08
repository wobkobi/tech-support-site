// src/shared/lib/rate-limit.ts
/**
 * @file rate-limit.ts
 * @description In-memory fixed-window rate limiter for public POST routes.
 *
 * Vercel serverless instances each hold their own bucket map, so the effective
 * global limit per IP is roughly N_instances times the per-instance limit. For
 * a low-traffic site this is acceptable; swap for an Upstash/Redis-backed
 * limiter if/when stricter global enforcement becomes necessary.
 */

import { NextRequest, NextResponse } from "next/server";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

/**
 * Records a hit against the named bucket and reports whether it is allowed.
 * Uses a simple fixed window: the first hit starts a window of `windowMs`,
 * and the bucket is reset once the window expires.
 * @param key - Bucket identifier (typically `route:ip`).
 * @param limit - Maximum allowed hits within the window.
 * @param windowMs - Window length in milliseconds.
 * @returns Object with `allowed` and the `retryAfterMs` when blocked.
 */
export function rateLimit(
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
 * Extracts the client IP from a request, preferring `x-forwarded-for` (set by
 * Vercel's edge), falling back to `x-real-ip`, then to the literal `"unknown"`.
 * Multiple IPs in `x-forwarded-for` are split and the first (originating) one
 * is returned.
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
 * Convenience wrapper that runs `rateLimit` and, when blocked, returns a
 * 429 response carrying a `Retry-After` header. Returns null when the request
 * should proceed.
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
