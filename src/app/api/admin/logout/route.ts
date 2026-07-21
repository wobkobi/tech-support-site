// src/app/api/admin/logout/route.ts
/**
 * @description Admin logout endpoint. Clears the session cookie. No auth
 * required to log out - hitting this endpoint without a session is a no-op.
 */

import { ADMIN_SESSION_COOKIE } from "@/shared/lib/admin-session";
import { NextResponse } from "next/server";

/**
 * POST /api/admin/logout
 * Clears the admin session cookie and returns `{ ok: true }`.
 * @returns JSON response with the cookie clear instruction.
 */
export function POST(): NextResponse {
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
