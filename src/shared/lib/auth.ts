// src/shared/lib/auth.ts
// Admin auth: browser sessions via a signed cookie (admin-session.ts); scripts and cron pass the header.

import { ADMIN_SESSION_COOKIE, verifySessionCookieValue } from "@/shared/lib/admin-session";
import { getClientIp } from "@/shared/lib/rate-limit";
import { timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest } from "next/server";

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

// Per-IP failed-auth bucket. Only wrong/missing X-Admin-Secret attempts count,
// so the operator's legitimate (successful) traffic never hits the limit.
interface AuthFailBucket {
  count: number;
  resetAt: number;
}
const authFailBuckets = new Map<string, AuthFailBucket>();
const AUTH_FAIL_LIMIT = 30;
const AUTH_FAIL_WINDOW_MS = 60_000;
const AUTH_FAIL_MAX_BUCKETS = 1_000;

/**
 * Whether the IP is over its failed-auth budget. Read-only.
 * @param ip - Client IP from {@link getClientIp}.
 * @returns Whether to fast-fail this request.
 */
function isOverAuthFailLimit(ip: string): boolean {
  const b = authFailBuckets.get(ip);
  if (!b || b.resetAt <= Date.now()) return false;
  return b.count > AUTH_FAIL_LIMIT;
}

/**
 * Records a failed admin-auth attempt for the IP, evicting stale buckets to cap memory.
 * @param ip - Client IP from {@link getClientIp}.
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
 * Checks for valid admin credentials: signed cookie or X-Admin-Secret header. After 30 failures
 * a minute an IP fast-fails; successes never count.
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
 * Server component/action gate matching {@link isAdminRequest}; redirects to
 * `/admin/login?next=...`. Defence in depth behind the proxy.
 * @param redirectPath - Path to land back on after login (defaults to `/admin`).
 */
export async function requireAdminAuth(redirectPath = "/admin"): Promise<void> {
  const store = await cookies();
  const value = store.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  const ok = await verifySessionCookieValue(value);
  if (ok) return;

  // Accept X-Admin-Secret too, so scripts get the page instead of a login redirect (browsers can't
  // set it on navigation). Rate-limited per IP as on the API side.
  const headerStore = await headers();
  const ip =
    headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headerStore.get("x-real-ip")?.trim() ||
    "unknown";
  if (!isOverAuthFailLimit(ip)) {
    if (isValidAdminToken(headerStore.get("x-admin-secret"))) return;
    recordAuthFail(ip);
  }

  redirect(`/admin/login?next=${encodeURIComponent(redirectPath)}`);
}

/**
 * Checks a Bearer token against CRON_SECRET in constant time.
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
 * Validates cron authorisation; Bearer token only, as cron-job.org is the sole scheduler.
 * @param request - The incoming request to verify.
 * @returns True if authorised, false otherwise.
 */
export function isCronAuthorised(request: NextRequest): boolean {
  return isValidCronBearer(request.headers.get("authorization"));
}
