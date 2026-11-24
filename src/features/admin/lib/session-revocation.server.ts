// src/features/admin/lib/session-revocation.server.ts
// Server-side sign-out of admin sessions. A signed cookie stays cryptographically valid until it
// expires, so isAdminRequest and requireAdminAuth also reject one that is revoked here: either
// its sign-in-log row has `signedOutAt`, or it was issued before the "sign out everywhere" cutoff
// (which also catches sessions from before the log existed).

import {
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createSessionCookieValue,
  readSessionPayload,
} from "@/shared/lib/admin-session";
import { prisma } from "@/shared/lib/prisma";

/** Setting row holding the cutoff: sessions issued before this unix second are signed out. */
const CUTOFF_KEY = "admin-session:revoked-before";

/**
 * Whether a verified session cookie has been signed out from the server. Two indexed lookups per
 * request, uncached so a sign-out applies at once on every route and instance (a module-level
 * cache isn't shared: Next can hold a separate copy per route). Fails open (false) on a database
 * error, so an outage can't lock the operator out; the signature check still applies.
 * @param cookieValue - A session cookie that already passed signature and expiry checks.
 * @returns True when the session must be refused.
 */
export async function isSessionRevoked(cookieValue: string): Promise<boolean> {
  const payload = readSessionPayload(cookieValue);
  if (!payload) return true;
  try {
    const [cutoffRow, signedOut] = await Promise.all([
      prisma.setting.findUnique({ where: { key: CUTOFF_KEY }, select: { value: true } }),
      prisma.adminSignIn.findFirst({
        where: { sessionId: payload.id, signedOutAt: { not: null } },
        select: { id: true },
      }),
    ]);
    return payload.iat < (Number(cutoffRow?.value) || 0) || signedOut !== null;
  } catch (err) {
    console.error("[session-revocation] load failed", err);
    return false;
  }
}

/**
 * Signs out one session by its sign-in-log row.
 * @param rowId - AdminSignIn id.
 * @returns True when an active session was signed out.
 */
export async function revokeSession(rowId: string): Promise<boolean> {
  const { count } = await prisma.adminSignIn.updateMany({
    where: { id: rowId, outcome: "ok", signedOutAt: null },
    data: { signedOutAt: new Date() },
  });
  return count > 0;
}

/**
 * Signs out every session except the caller's. Moves the cutoff to now, which ends every cookie
 * (logged or not), and gives the caller a fresh cookie issued at the cutoff second, which
 * passes because the check is strictly "issued before". The caller's log row takes the new id.
 * The cutoff moves last: should an earlier write fail, the caller's current cookie still works
 * and the route never got to set the new one.
 * @param currentCookie - The caller's verified session cookie.
 * @returns The replacement cookie value for the caller and when it expires.
 */
export async function revokeAllOtherSessions(
  currentCookie: string,
): Promise<{ cookieValue: string; expiresAt: Date }> {
  const current = readSessionPayload(currentCookie);
  const now = new Date();
  const cutoff = Math.floor(now.getTime() / 1000);
  const cookieValue = await createSessionCookieValue();
  const fresh = readSessionPayload(cookieValue);
  const expiresAt = new Date(now.getTime() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000);

  if (current && fresh) {
    await prisma.adminSignIn.updateMany({
      where: { sessionId: current.id },
      data: { sessionId: fresh.id, expiresAt, lastSeenAt: now },
    });
  }
  await prisma.adminSignIn.updateMany({
    where: {
      outcome: "ok",
      signedOutAt: null,
      sessionId: { notIn: [current?.id, fresh?.id].filter((id) => id !== undefined) },
    },
    data: { signedOutAt: now },
  });
  await prisma.setting.upsert({
    where: { key: CUTOFF_KEY },
    create: { key: CUTOFF_KEY, value: String(cutoff) },
    update: { value: String(cutoff) },
  });
  return { cookieValue, expiresAt };
}
