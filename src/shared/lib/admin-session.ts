// src/shared/lib/admin-session.ts
/**
 * @description Signed session-cookie helpers for the admin panel. Uses the
 * Web Crypto API so the same helpers work in both Node (server components,
 * API routes) and Edge (Next.js proxy). The cookie value is
 * `<payloadB64Url>.<sigB64Url>` where the signature is an HMAC-SHA256 of the
 * payload signed with `ADMIN_SECRET`. Rotating the secret invalidates every
 * session - the desired behaviour.
 */

/** Cookie name for the admin session. */
export const ADMIN_SESSION_COOKIE = "__admin_session";

/** Session validity in seconds (30 days). */
export const ADMIN_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

interface SessionPayload {
  /** Issued-at unix seconds. */
  iat: number;
  /** Expiry unix seconds. */
  exp: number;
  /** Random nonce so two sessions issued in the same second have distinct values. */
  n: string;
}

/**
 * Base64url-encodes a Uint8Array without padding (matches JWT / RFC4648).
 * @param bytes - Bytes to encode.
 * @returns Base64url string.
 */
function bytesToB64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decodes a base64url string back to bytes. Tolerant of missing padding.
 * @param input - Base64url string.
 * @returns Decoded bytes.
 */
function b64UrlToBytes(input: string): Uint8Array {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/**
 * Constant-time byte equality. Web Crypto has no `timingSafeEqual` so a
 * manual XOR-then-OR loop is the portable substitute.
 * @param a - First byte sequence.
 * @param b - Second byte sequence.
 * @returns True when bytes are equal in length and content.
 */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Imports the secret as an HMAC-SHA256 key. Done per-call rather than cached
 * because Edge runtime instances may be cold/recycled aggressively.
 * @param secret - Shared secret (typically `process.env.ADMIN_SECRET`).
 * @returns CryptoKey suitable for `crypto.subtle.sign` / `verify`.
 */
async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Mints a signed session-cookie value valid for {@link ADMIN_SESSION_MAX_AGE_SECONDS}.
 * Signs with `process.env.ADMIN_SECRET` (no separate signing key - rotating
 * the admin secret intentionally invalidates every session).
 * @returns Cookie value `<payload>.<sig>` ready to set on `Set-Cookie`.
 */
export async function createSessionCookieValue(): Promise<string> {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("ADMIN_SECRET is not configured");

  const nonceBytes = new Uint8Array(12);
  crypto.getRandomValues(nonceBytes);
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    iat: now,
    exp: now + ADMIN_SESSION_MAX_AGE_SECONDS,
    n: bytesToB64Url(nonceBytes),
  };
  const payloadB64 = bytesToB64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret);
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64)),
  );
  return `${payloadB64}.${bytesToB64Url(sig)}`;
}

/**
 * Verifies a session-cookie value: parses, recomputes the HMAC, compares in
 * constant time, then checks the expiry. Returns false for any malformed,
 * tampered, or expired input. Never throws.
 * @param cookieValue - Raw cookie value (`<payload>.<sig>`), or null/undefined.
 * @returns True when the session is genuine and unexpired.
 */
export async function verifySessionCookieValue(
  cookieValue: string | null | undefined,
): Promise<boolean> {
  if (!cookieValue) return false;
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const dot = cookieValue.indexOf(".");
  if (dot <= 0 || dot === cookieValue.length - 1) return false;
  const payloadB64 = cookieValue.slice(0, dot);
  const sigB64 = cookieValue.slice(dot + 1);

  try {
    const key = await importHmacKey(secret);
    const expected = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64)),
    );
    const actual = b64UrlToBytes(sigB64);
    if (!timingSafeEqualBytes(expected, actual)) return false;

    const payload = JSON.parse(
      new TextDecoder().decode(b64UrlToBytes(payloadB64)),
    ) as SessionPayload;
    if (typeof payload.exp !== "number" || typeof payload.iat !== "number") return false;
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp <= nowSec) return false;
    return true;
  } catch {
    return false;
  }
}
