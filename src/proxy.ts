// src/proxy.ts
/**
 * @file proxy.ts
 * @description Edge chokepoint for admin/business routes (Next.js 16 proxy,
 * formerly `middleware.ts`). Per-route checks via `isAdminRequest` /
 * `requireAdminToken` still run as belt-and-braces.
 */

import { NextRequest, NextResponse } from "next/server";

const PROTECTED_API_PREFIXES = ["/api/admin/", "/api/business/"];
const PROTECTED_PAGE_PREFIX = "/admin";

/**
 * Compares a caller-supplied secret against ADMIN_SECRET. Edge runtime has no
 * `timingSafeEqual`; per-route Node handlers re-check with constant time.
 * @param provided - Secret value pulled from a header or searchParam.
 * @returns True when the value matches `process.env.ADMIN_SECRET`.
 */
function hasValidSecret(provided: string | null): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !provided) return false;
  if (provided.length !== secret.length) return false;
  return provided === secret;
}

/**
 * Gates `/api/admin/*` and `/api/business/*` on `x-admin-secret` header, and
 * `/admin/*` on `?token=` searchParam. Mirrors `requireAdminToken`'s 404
 * behaviour on bad page tokens; returns 401 JSON on bad API headers.
 * @param request - Incoming Next.js request.
 * @returns A 401 / rewrite response when auth fails, otherwise `NextResponse.next()`.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, searchParams } = request.nextUrl;

  if (PROTECTED_API_PREFIXES.some((p) => pathname.startsWith(p))) {
    if (!hasValidSecret(request.headers.get("x-admin-secret"))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname === PROTECTED_PAGE_PREFIX || pathname.startsWith(`${PROTECTED_PAGE_PREFIX}/`)) {
    if (!hasValidSecret(searchParams.get("token"))) {
      return NextResponse.rewrite(new URL("/_not-found", request.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/admin/:path*", "/api/business/:path*", "/admin", "/admin/:path*"],
};
