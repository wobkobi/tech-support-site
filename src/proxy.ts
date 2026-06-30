// src/proxy.ts
/**
 * @description Edge chokepoint for admin/business routes (Next.js 16 proxy,
 * formerly `middleware.ts`). Accepts EITHER a signed session cookie (browser
 * path, set on /admin/login) OR the `x-admin-secret` header (scripts + cron).
 * Per-route checks via `isAdminRequest` / `requireAdminAuth` still run as
 * belt-and-braces.
 */

import { ADMIN_SESSION_COOKIE, verifySessionCookieValue } from "@/shared/lib/admin-session";
import { NextRequest, NextResponse } from "next/server";

const PROTECTED_API_PREFIXES = ["/api/admin/", "/api/business/"];
const PROTECTED_PAGE_PREFIX = "/admin";

// Public-by-design exceptions that must NOT require auth (the login flow
// itself, plus the logout endpoint which is a no-op when unauthenticated).
const PUBLIC_EXCEPTIONS = ["/admin/login", "/api/admin/login", "/api/admin/logout"];

/**
 * Edge-safe constant-time-ish string compare against `ADMIN_SECRET`. Edge
 * runtime has no `timingSafeEqual`; the per-route Node handlers re-check with
 * the real constant-time path.
 * @param provided - Secret value pulled from a header.
 * @returns True when the value matches `process.env.ADMIN_SECRET`.
 */
function hasValidHeaderSecret(provided: string | null): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !provided) return false;
  if (provided.length !== secret.length) return false;
  return provided === secret;
}

/**
 * True when the incoming request carries a valid admin session cookie OR a
 * valid `x-admin-secret` header. Cookie wins because it's the browser path.
 * @param request - Incoming Next.js request.
 * @returns Whether the request should be allowed through.
 */
async function hasAdminAccess(request: NextRequest): Promise<boolean> {
  const cookieValue = request.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  if (cookieValue && (await verifySessionCookieValue(cookieValue))) return true;
  return hasValidHeaderSecret(request.headers.get("x-admin-secret"));
}

/**
 * Gates `/api/admin/*` and `/api/business/*` (401 on missing/invalid auth)
 * and `/admin/*` (redirect to /admin/login on missing/invalid auth). Public
 * exceptions are listed in {@link PUBLIC_EXCEPTIONS}.
 * @param request - Incoming Next.js request.
 * @returns A 401 / redirect / next response depending on auth state.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (PUBLIC_EXCEPTIONS.some((p) => pathname === p)) {
    return NextResponse.next();
  }

  if (PROTECTED_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (await hasAdminAccess(request)) return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (pathname === PROTECTED_PAGE_PREFIX || pathname.startsWith(`${PROTECTED_PAGE_PREFIX}/`)) {
    if (await hasAdminAccess(request)) return NextResponse.next();
    // Bounce the operator to the login page with a `next=` so they land back
    // on the page they were trying to reach after sign-in.
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/admin/:path*", "/api/business/:path*", "/admin", "/admin/:path*"],
};
