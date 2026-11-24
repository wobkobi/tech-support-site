// src/shared/lib/admin-secret.ts
// The X-Admin-Secret check shared by the proxy and the route/page gates: a constant-time compare
// plus a per-IP budget of wrong guesses. Kept free of DB and next/headers imports so the proxy
// can use it. Each bundle (proxy, routes) keeps its own counts, so every gate a guess passes
// through counts it.

import { timingSafeEqual } from "crypto";

/** Wrong guesses an IP gets per window before every header check fails fast. */
const AUTH_FAIL_LIMIT = 30;
const AUTH_FAIL_WINDOW_MS = 60_000;
const AUTH_FAIL_MAX_BUCKETS = 1_000;

// Only wrong or missing header attempts count, so the operator's own traffic never hits the limit.
const authFailBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Validates a token against ADMIN_SECRET using constant-time comparison.
 * @param token - Token to validate.
 * @returns True if the token matches ADMIN_SECRET.
 */
function isValidAdminToken(token: string | null | undefined): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !token) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

/**
 * Whether the IP is over its wrong-guess budget. Read-only.
 * @param ip - Client IP.
 * @returns Whether to fail this request fast.
 */
export function isOverAuthFailLimit(ip: string): boolean {
  const b = authFailBuckets.get(ip);
  if (!b || b.resetAt <= Date.now()) return false;
  return b.count > AUTH_FAIL_LIMIT;
}

/**
 * Records a wrong guess for the IP, evicting stale buckets to cap memory.
 * @param ip - Client IP.
 */
function recordAuthFail(ip: string): void {
  const now = Date.now();
  let b = authFailBuckets.get(ip);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + AUTH_FAIL_WINDOW_MS };
    authFailBuckets.set(ip, b);
  }
  b.count++;
  if (authFailBuckets.size > AUTH_FAIL_MAX_BUCKETS) {
    for (const [k, v] of authFailBuckets) {
      if (v.resetAt <= now) authFailBuckets.delete(k);
    }
  }
}

/**
 * Checks an X-Admin-Secret value for an IP: fails fast once the IP is over its budget, and
 * counts a wrong or missing value against it.
 * @param ip - Client IP.
 * @param provided - The header value, or null.
 * @returns True when it matches ADMIN_SECRET and the IP isn't locked out.
 */
export function checkAdminSecretHeader(ip: string, provided: string | null): boolean {
  if (isOverAuthFailLimit(ip)) return false;
  const ok = isValidAdminToken(provided);
  if (!ok) recordAuthFail(ip);
  return ok;
}
