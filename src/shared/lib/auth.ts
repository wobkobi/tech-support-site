// src/shared/lib/auth.ts
// Admin auth: browser sessions via a signed cookie (admin-session.ts); scripts and cron pass the header.

import { isSessionRevoked } from "@/features/admin/lib/session-revocation.server";
import { touchSession } from "@/features/admin/lib/sign-in-log.server";
import { checkAdminSecretHeader, isOverAuthFailLimit } from "@/shared/lib/admin-secret";
import { ADMIN_SESSION_COOKIE, verifySessionCookieValue } from "@/shared/lib/admin-session";
import { getClientIp } from "@/shared/lib/rate-limit";
import { timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after, NextRequest } from "next/server";

/**
 * Checks for valid admin credentials: a signed, not signed-out cookie or the X-Admin-Secret
 * header. After 30 failures a minute an IP fast-fails; successes never count.
 * @param req - The incoming request.
 * @returns True if the request has valid admin credentials.
 */
export async function isAdminRequest(req: NextRequest): Promise<boolean> {
  const ip = getClientIp(req);
  if (isOverAuthFailLimit(ip)) return false;
  // Session cookie is the primary browser-driven path; check it first so the
  // header path is only consulted for explicit script / cron callers.
  const cookieValue = req.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  if (cookieValue && (await verifySessionCookieValue(cookieValue))) {
    // A signed-out device's open tab isn't an attack; refuse it without filling the IP's
    // failure budget, which a signed-in device on the same wifi shares.
    return !(await isSessionRevoked(cookieValue));
  }
  return checkAdminSecretHeader(ip, req.headers.get("x-admin-secret"));
}

/**
 * Server component/action gate matching {@link isAdminRequest}; redirects to
 * `/admin/login?next=...`. Defence in depth behind the proxy, which can't see server-side
 * sign-outs. A cookie session also gets its last-seen time bumped in the sign-in log.
 * @param redirectPath - Path to land back on after login (defaults to `/admin`).
 */
export async function requireAdminAuth(redirectPath = "/admin"): Promise<void> {
  const store = await cookies();
  const value = store.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  if (value && (await verifySessionCookieValue(value))) {
    if (await isSessionRevoked(value)) {
      redirect(`/admin/login?next=${encodeURIComponent(redirectPath)}`);
    }
    after(() => touchSession(value));
    return;
  }

  // Accept X-Admin-Secret too, so scripts get the page instead of a login redirect (browsers can't
  // set it on navigation). Rate-limited per IP as on the API side.
  const headerStore = await headers();
  if (
    checkAdminSecretHeader(getClientIp({ headers: headerStore }), headerStore.get("x-admin-secret"))
  ) {
    return;
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

/**
 * Checks an OwnTracks request: HTTP Basic, the password matching OWNTRACKS_SECRET in constant
 * time. The username is ignored; OwnTracks can't log in, so this is its only credential.
 * @param password - Password from the Basic header, or null when there isn't one.
 * @returns True if it matches OWNTRACKS_SECRET.
 */
export function isOwnTracksPassword(password: string | null): boolean {
  const secret = process.env.OWNTRACKS_SECRET;
  if (!secret || !password) return false;
  try {
    const a = Buffer.from(password);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
