// src/app/api/admin/login/route.ts
/**
 * @file route.ts
 * @description Admin login endpoint. Verifies the operator-supplied secret
 * against `ADMIN_SECRET`, then sets a signed session cookie. Rate-limited per
 * IP via the shared {@link rateLimitOrReject} helper so a brute-force on the secret
 * stops fast.
 */

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
 * Body: `{ secret: string }`. On match sets the session cookie and returns
 * `{ ok: true }`; on mismatch returns 401 with a generic message. The
 * shared per-IP limiter caps brute-force attempts at 10/minute.
 * @param request - Incoming login request.
 * @returns JSON response.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Tight cap on this route specifically - much lower than the global admin
  // failure budget because no legitimate operator types the wrong password
  // 10 times in a minute.
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
