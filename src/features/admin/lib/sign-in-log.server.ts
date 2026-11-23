// src/features/admin/lib/sign-in-log.server.ts
// Admin sign-in log: every form attempt with where it came from, and each successful one tracked
// as a session (last seen, signed out) for the Sign-ins page. Logging never blocks or fails auth.

import { readSessionId } from "@/shared/lib/admin-session";
import { prisma } from "@/shared/lib/prisma";

/** Rows older than this are deleted as new attempts come in. */
const KEEP_DAYS = 180;

/** `lastSeenAt` is only rewritten when it is older than this, so page loads stay one cheap query. */
const TOUCH_EVERY_MS = 5 * 60_000;

/** Outcome of one sign-in attempt. */
export type SignInOutcome = "ok" | "wrong" | "bad-request";

/** Request details worth keeping with an attempt. */
export interface SignInSource {
  ip: string;
  userAgent: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

/**
 * Where a request came from: IP, user agent and Vercel's geo headers (absent locally).
 * Vercel URL-encodes the city ("Auckland" is plain, "Te%20Awamutu" isn't).
 * @param h - Request headers.
 * @param ip - Client IP, already resolved by the caller.
 * @returns The source details.
 */
export function signInSourceFrom(h: Headers, ip: string): SignInSource {
  /**
   * URL-decodes a geo header, keeping the raw value when it isn't valid encoding.
   * @param v - Header value, or null when absent.
   * @returns The decoded value, or null.
   */
  const decode = (v: string | null): string | null => {
    if (!v) return null;
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };
  return {
    ip,
    userAgent: h.get("user-agent")?.slice(0, 400) ?? null,
    city: decode(h.get("x-vercel-ip-city")),
    region: h.get("x-vercel-ip-country-region"),
    country: h.get("x-vercel-ip-country"),
  };
}

/**
 * Records one sign-in attempt and prunes rows past {@link KEEP_DAYS}. Swallows errors.
 * @param outcome - What happened.
 * @param source - Where it came from.
 * @param session - For a successful sign-in: the new cookie value and when it expires.
 * @param session.cookieValue - The session cookie just issued.
 * @param session.expiresAt - When that cookie expires.
 */
export async function recordSignIn(
  outcome: SignInOutcome,
  source: SignInSource,
  session?: { cookieValue: string; expiresAt: Date },
): Promise<void> {
  try {
    const now = new Date();
    await prisma.adminSignIn.create({
      data: {
        at: now,
        outcome,
        ...source,
        sessionId: session ? readSessionId(session.cookieValue) : null,
        expiresAt: session?.expiresAt ?? null,
        lastSeenAt: session ? now : null,
        // Explicit null: on MongoDB an omitted field is missing, which `signedOutAt: null` filters skip.
        signedOutAt: null,
      },
    });
    await prisma.adminSignIn.deleteMany({
      where: { at: { lt: new Date(now.getTime() - KEEP_DAYS * 86_400_000) } },
    });
  } catch (err) {
    console.error("[sign-in-log] record failed", err);
  }
}

/**
 * Bumps the session's `lastSeenAt` when it is more than {@link TOUCH_EVERY_MS} old. Swallows
 * errors. Sessions from before the log existed have no row and are left alone.
 * @param cookieValue - A verified session cookie value.
 */
export async function touchSession(cookieValue: string): Promise<void> {
  const sessionId = readSessionId(cookieValue);
  if (!sessionId) return;
  try {
    const now = new Date();
    await prisma.adminSignIn.updateMany({
      where: {
        sessionId,
        signedOutAt: null,
        lastSeenAt: { lt: new Date(now.getTime() - TOUCH_EVERY_MS) },
      },
      data: { lastSeenAt: now },
    });
  } catch (err) {
    console.error("[sign-in-log] touch failed", err);
  }
}

/**
 * Stamps the session as signed out. Swallows errors.
 * @param cookieValue - The session cookie being cleared (may be missing or invalid).
 */
export async function markSignedOut(cookieValue: string | null | undefined): Promise<void> {
  const sessionId = readSessionId(cookieValue);
  if (!sessionId) return;
  try {
    await prisma.adminSignIn.updateMany({
      where: { sessionId, signedOutAt: null },
      data: { signedOutAt: new Date() },
    });
  } catch (err) {
    console.error("[sign-in-log] sign-out failed", err);
  }
}
