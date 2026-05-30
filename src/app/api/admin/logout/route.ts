// src/app/api/admin/logout/route.ts
/**
 * @file route.ts
 * @description Admin logout endpoint. Clears the session cookie. No auth
 * required to log out - hitting this endpoint without a session is a no-op.
 */

import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/shared/lib/admin-session";

/**
 * POST /api/admin/logout
 * Clears the admin session cookie and returns `{ ok: true }`.
 * @returns JSON response with the cookie clear instruction.
 */
export async function POST(): Promise<NextResponse> {
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
