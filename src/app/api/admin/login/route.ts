// src/app/api/admin/login/route.ts
// Admin login: checks the secret against `ADMIN_SECRET` and sets a signed cookie. Rate-limited per IP.

import { recordSignIn, signInSourceFrom } from "@/features/admin/lib/sign-in-log.server";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createSessionCookieValue,
} from "@/shared/lib/admin-session";
import { errorResponse } from "@/shared/lib/api-response";
import { getClientIp, rateLimitOrReject } from "@/shared/lib/rate-limit";
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
 * Body: `{ secret: string }`. Sets the session cookie on match, else 401. Every attempt past the
 * rate limit is written to the sign-in log.
 * @param request - Incoming login request.
 * @returns JSON response.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Tighter than the global admin failure budget.
  const limited = rateLimitOrReject(request, "admin-login", 10, 60_000);
  if (limited) return limited;

  const source = signInSourceFrom(request.headers, getClientIp(request));
  let body: { secret?: unknown } = {};
  try {
    body = (await request.json()) as { secret?: unknown };
  } catch {
    await recordSignIn("bad-request", source);
    return errorResponse("Bad request.", 400);
  }
  // Its own status, so the form can say the site is misconfigured rather than "wrong secret".
  if (!process.env.ADMIN_SECRET) {
    console.error("[admin/login] ADMIN_SECRET is not set.");
    return errorResponse("Not configured.", 503);
  }
  const candidate = typeof body.secret === "string" ? body.secret : "";
  if (!matchesAdminSecret(candidate)) {
    await recordSignIn("wrong", source);
    return errorResponse("Invalid credentials.", 401);
  }

  const cookieValue = await createSessionCookieValue();
  await recordSignIn("ok", source, {
    cookieValue,
    expiresAt: new Date(Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000),
  });
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
