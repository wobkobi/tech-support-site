// src/shared/lib/auth.ts
/**
 * @file auth.ts
 * @description Shared authentication utilities for admin routes and pages.
 */

import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { notFound } from "next/navigation";
import { getClientIp } from "@/shared/lib/rate-limit";

/**
 * Validates a token against ADMIN_SECRET using constant-time comparison.
 * @param token - Token to validate.
 * @returns True if the token matches ADMIN_SECRET.
 */
export function isValidAdminToken(token: string | null | undefined): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !token) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

/**
 * Validates the admin token from page searchParams, calling notFound() if invalid.
 * @param token - Token string from URL search params (may be undefined)
 * @returns The validated token string
 */
export function requireAdminToken(token: string | undefined): string {
  if (!isValidAdminToken(token ?? null)) notFound();
  return token!;
}

// Per-IP failed-auth bucket. Only counts admin requests with a wrong/missing
// X-Admin-Secret header so the operator's legitimate (successful) traffic
// never hits the limit. When an IP exceeds the threshold within the window,
// subsequent isAdminRequest calls from that IP fast-fail (return false
// without running timingSafeEqual) until the window expires.
interface AuthFailBucket {
  count: number;
  resetAt: number;
}
const authFailBuckets = new Map<string, AuthFailBucket>();
const AUTH_FAIL_LIMIT = 30;
const AUTH_FAIL_WINDOW_MS = 60_000;
const AUTH_FAIL_MAX_BUCKETS = 1_000;

/**
 * Returns true when the given IP is currently over its failed-auth budget.
 * Read-only check; does not increment.
 * @param ip - Client IP from `getClientIp`.
 * @returns Whether to fast-fail this request.
 */
function isOverAuthFailLimit(ip: string): boolean {
  const b = authFailBuckets.get(ip);
  if (!b || b.resetAt <= Date.now()) return false;
  return b.count > AUTH_FAIL_LIMIT;
}

/**
 * Records one failed admin-auth attempt against the IP's bucket. Also runs an
 * opportunistic eviction pass so a burst of unique IPs can't leak memory.
 * @param ip - Client IP from `getClientIp`.
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
 * Checks if a request has valid admin credentials via X-Admin-Secret header.
 * Failed attempts are rate-limited per-IP - after 30 failures in a minute,
 * further checks from that IP fast-fail without running the constant-time
 * comparison. Successful attempts never count, so the operator's legitimate
 * traffic is unaffected.
 * @param req - The incoming request.
 * @returns True if the request has valid admin credentials.
 */
export function isAdminRequest(req: NextRequest): boolean {
  const ip = getClientIp(req);
  if (isOverAuthFailLimit(ip)) return false;
  const ok = isValidAdminToken(req.headers.get("x-admin-secret"));
  if (!ok) recordAuthFail(ip);
  return ok;
}

/**
 * Validates a Bearer token from an Authorization header against CRON_SECRET
 * using constant-time comparison.
 * @param authHeader - Raw Authorization header value (e.g. "Bearer xyz") or null.
 * @returns True if the token matches CRON_SECRET.
 */
function isValidCronBearer(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader) return false;
  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return false;
  const token = authHeader.slice(prefix.length);
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Validates cron authorization. Bearer-token-only; cron-job.org is the sole
 * scheduler.
 * @param request - The incoming request to verify.
 * @returns True if authorized, false otherwise.
 */
export function isCronAuthorized(request: NextRequest): boolean {
  return isValidCronBearer(request.headers.get("authorization"));
}
