// src/features/mailing/lib/unsubscribe-token.ts
// Signed unsubscribe tokens for mailing-list links. The token is the contact id plus an
// HMAC of it, so nothing is stored per contact and nobody can unsubscribe someone else
// by guessing an id. Rotating UNSUBSCRIBE_SECRET breaks every link already sent.

import { createHmac, timingSafeEqual } from "crypto";

/** Contact ids are Mongo ObjectIds: 24 hex characters. */
const CONTACT_ID_RE = /^[a-f0-9]{24}$/;

/**
 * The secret, or null when unset. Mailing sends refuse to run without it, since
 * a marketing email with no working unsubscribe link breaks the NZ spam act.
 * @returns The trimmed secret or null.
 */
export function unsubscribeSecret(): string | null {
  return process.env.UNSUBSCRIBE_SECRET?.trim() || null;
}

/**
 * HMAC-SHA256 of a contact id, base64url-encoded.
 * @param contactId - Contact id.
 * @param secret - The unsubscribe secret.
 * @returns The signature.
 */
function sign(contactId: string, secret: string): string {
  return createHmac("sha256", secret).update(`unsubscribe:${contactId}`).digest("base64url");
}

/**
 * Builds a contact's unsubscribe token.
 * @param contactId - Contact id.
 * @returns `<contactId>.<signature>`.
 * @throws {Error} When UNSUBSCRIBE_SECRET is unset.
 */
export function signUnsubscribeToken(contactId: string): string {
  const secret = unsubscribeSecret();
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is not set");
  return `${contactId}.${sign(contactId, secret)}`;
}

/**
 * Checks a token from an unsubscribe link.
 * @param token - Token from the URL.
 * @returns The contact id it was signed for, or null when it is malformed or forged.
 */
export function verifyUnsubscribeToken(token: string): string | null {
  const secret = unsubscribeSecret();
  if (!secret) return null;
  const [contactId, signature, extra] = token.split(".");
  if (!contactId || !signature || extra !== undefined || !CONTACT_ID_RE.test(contactId)) {
    return null;
  }
  const expected = Buffer.from(sign(contactId, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return null;
  return timingSafeEqual(expected, actual) ? contactId : null;
}
