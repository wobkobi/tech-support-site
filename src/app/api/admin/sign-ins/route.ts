// src/app/api/admin/sign-ins/route.ts
// Sign out admin sessions from the Sign-ins page: one device, or every device but this one.

import {
  revokeAllOtherSessions,
  revokeSession,
} from "@/features/admin/lib/session-revocation.server";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  readSessionId,
} from "@/shared/lib/admin-session";
import { errorResponse } from "@/shared/lib/api-response";
import { isAdminRequest } from "@/shared/lib/auth";
import { prisma } from "@/shared/lib/prisma";
import { type NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/sign-ins
 * Body `{ action: "one", id }` signs out that session (not this one; use Sign out for that), or
 * `{ action: "others" }` signs out every session but this one and re-issues this one's cookie.
 * @param request - Incoming request with the operator's session cookie.
 * @returns JSON `{ ok: true }`, or an error.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!(await isAdminRequest(request))) return errorResponse("Unauthorized", 401);
  const current = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (!current) return errorResponse("Sign in with the form to manage sessions.", 400);

  let body: { action?: unknown; id?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("Bad request.", 400);
  }

  if (body.action === "one") {
    if (typeof body.id !== "string" || !/^[a-f0-9]{24}$/.test(body.id)) {
      return errorResponse("Bad session id.", 400);
    }
    const row = await prisma.adminSignIn.findUnique({
      where: { id: body.id },
      select: { sessionId: true },
    });
    if (row?.sessionId && row.sessionId === readSessionId(current)) {
      return errorResponse("That's this device. Use Sign out instead.", 400);
    }
    if (!(await revokeSession(body.id))) return errorResponse("Already signed out.", 404);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "others") {
    const { cookieValue } = await revokeAllOtherSessions(current);
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

  return errorResponse("Unknown action.", 400);
}
