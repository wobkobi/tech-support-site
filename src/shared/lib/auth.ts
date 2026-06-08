// src/shared/lib/auth.ts
/**
 * @file auth.ts
 * @description Shared authentication utilities for admin routes and pages.
 * Browser sessions go through a signed cookie (see `admin-session.ts`);
 * scripts + cron still pass the header so curl / cron-job.org keep working.
 */

import { ADMIN_SESSION_COOKIE, verifySessionCookieValue } from "@/shared/lib/admin-session";
import { getClientIp } from "@/shared/lib/rate-limit";
import { timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";

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
 * Checks if a request has valid admin credentials. Accepts either the signed
 * session cookie (browser path) or the X-Admin-Secret header (scripts / cron).
 * Failed attempts are rate-limited per-IP - after 30 failures in a minute,
 * further checks from that IP fast-fail without running the comparison.
 * Successful attempts never count, so the operator's legitimate traffic is
 * unaffected.
 * @param req - The incoming request.
 * @returns True if the request has valid admin credentials.
 */
export async function isAdminRequest(req: NextRequest): Promise<boolean> {
  const ip = getClientIp(req);
  if (isOverAuthFailLimit(ip)) return false;
  // Session cookie is the primary browser-driven path; check it first so the
  // header path is only consulted for explicit script / cron callers.
  const cookieValue = req.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  if (cookieValue && (await verifySessionCookieValue(cookieValue))) return true;
  const ok = isValidAdminToken(req.headers.get("x-admin-secret"));
  if (!ok) recordAuthFail(ip);
  return ok;
}

/**
 * Server-component / server-action gate. Reads the admin session cookie via
 * `next/headers` and redirects to `/admin/login?next=...` when missing or
 * invalid. Defence-in-depth alongside the proxy guard - keeps individual
 * pages safe even if the proxy matcher misses something.
 * @param redirectPath - Path to land back on after login (defaults to `/admin`).
 */
export async function requireAdminAuth(redirectPath = "/admin"): Promise<void> {
  const store = await cookies();
  const value = store.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  const ok = await verifySessionCookieValue(value);
  if (ok) return;
  redirect(`/admin/login?next=${encodeURIComponent(redirectPath)}`);
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
