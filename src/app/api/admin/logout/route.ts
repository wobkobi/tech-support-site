// src/app/api/admin/logout/route.ts
// Admin logout endpoint. Clears the session cookie and marks the session signed out in the
// sign-in log. No auth required - hitting it without a session is a no-op.

import { markSignedOut } from "@/features/admin/lib/sign-in-log.server";
import { ADMIN_SESSION_COOKIE, verifySessionCookieValue } from "@/shared/lib/admin-session";
import { type NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/logout
 * Clears the admin session cookie and returns `{ ok: true }`.
 * @param request - Incoming request, carrying the session cookie being ended.
 * @returns JSON response with the cookie clear instruction.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Only a genuine cookie may stamp its row; this route is public.
  const cookieValue = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (await verifySessionCookieValue(cookieValue)) await markSignedOut(cookieValue);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
