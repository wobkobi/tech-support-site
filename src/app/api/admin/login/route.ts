// src/app/api/admin/login/route.ts
// Admin login: checks the secret against `ADMIN_SECRET` and sets a signed cookie. Rate-limited per IP.

import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createSessionCookieValue,
} from "@/shared/lib/admin-session";
import { errorResponse } from "@/shared/lib/api-response";
import { rateLimitOrReject } from "@/shared/lib/rate-limit";
import { timingSafeEqual } from "crypto";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Constant-time compare a candidate secret against `ADMIN_SECRET`.
 * @param candidate - User-supplied secret.
 * @returns True when the candidate matches the configured admin secret.
 */
function matchesAdminSecret(candidate: string): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !candidate) return false;
  try {
    const a = Buffer.from(candidate);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * POST /api/admin/login
 * Body: `{ secret: string }`. Sets the session cookie on match, else 401.
 * @param request - Incoming login request.
 * @returns JSON response.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Tighter than the global admin failure budget.
  const limited = rateLimitOrReject(request, "admin-login", 10, 60_000);
  if (limited) return limited;

  let body: { secret?: unknown } = {};
  try {
    body = (await request.json()) as { secret?: unknown };
  } catch {
    return errorResponse("Bad request.", 400);
  }
  const candidate = typeof body.secret === "string" ? body.secret : "";
  if (!matchesAdminSecret(candidate)) {
    return errorResponse("Invalid credentials.", 401);
  }

  const cookieValue = await createSessionCookieValue();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_SESSION_COOKIE, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
