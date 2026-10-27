// src/proxy.ts
// Edge gate for admin/business routes: a signed session cookie or the `x-admin-secret` header.
// Per-route checks still run as well.

import { ADMIN_SESSION_COOKIE, verifySessionCookieValue } from "@/shared/lib/admin-session";
import { NextRequest, NextResponse } from "next/server";

const PROTECTED_API_PREFIXES = ["/api/admin/", "/api/business/"];
const PROTECTED_PAGE_PREFIX = "/admin";

// Public-by-design exceptions that must NOT require auth (the login flow
// itself, plus the logout endpoint which is a no-op when unauthenticated).
const PUBLIC_EXCEPTIONS = ["/admin/login", "/api/admin/login", "/api/admin/logout"];

/**
 * Edge-safe near-constant-time compare against `ADMIN_SECRET` (no `timingSafeEqual` on Edge;
 * Node handlers re-check properly).
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
 * Whether the request has a valid admin session cookie or `x-admin-secret` header.
 * @param request - Incoming Next.js request.
 * @returns Whether the request should be allowed through.
 */
async function hasAdminAccess(request: NextRequest): Promise<boolean> {
  const cookieValue = request.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  if (cookieValue && (await verifySessionCookieValue(cookieValue))) return true;
  return hasValidHeaderSecret(request.headers.get("x-admin-secret"));
}

/**
 * Gates `/api/admin/*` and `/api/business/*` (401) and `/admin/*` (login redirect), except
 * {@link PUBLIC_EXCEPTIONS}.
 * @param request - Incoming Next.js request.
 * @returns A 401 / redirect / next response depending on auth state.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_EXCEPTIONS.some((p) => pathname === p)) {
    return NextResponse.next();
  }

  if (PROTECTED_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (await hasAdminAccess(request)) return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (pathname === PROTECTED_PAGE_PREFIX || pathname.startsWith(`${PROTECTED_PAGE_PREFIX}/`)) {
    if (await hasAdminAccess(request)) return NextResponse.next();
    // Bounce the operator to the login page with a `next=` so they land back on the page
    // they were trying to reach after sign-in, its filters and tab included.
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/admin/:path*", "/api/business/:path*", "/admin", "/admin/:path*"],
};
