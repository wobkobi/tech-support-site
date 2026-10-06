// src/features/mailing/lib/unsubscribe-token.ts
// Signed opt-out tokens: the mailing-list unsubscribe link and the review-ask "stop asking
// me" link. The token is the contact id plus an HMAC of it, so nothing is stored per
// contact and nobody can opt someone else out by guessing an id. Each kind signs its own
// purpose prefix, so one kind of token is never accepted as the other. Rotating
// UNSUBSCRIBE_SECRET breaks every link already sent.

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
 * What a token opts out of. The value is the signed prefix, so "unsubscribe" must stay
 * exactly as it is or every mailing link already sent stops working.
 */
type TokenPurpose = "unsubscribe" | "review-asks";

/**
 * HMAC-SHA256 of a purpose and contact id, base64url-encoded.
 * @param purpose - What the token opts out of.
 * @param contactId - Contact id.
 * @param secret - The unsubscribe secret.
 * @returns The signature.
 */
function sign(purpose: TokenPurpose, contactId: string, secret: string): string {
  return createHmac("sha256", secret).update(`${purpose}:${contactId}`).digest("base64url");
}

/**
 * Builds a token for one purpose.
 * @param purpose - What the token opts out of.
 * @param contactId - Contact id.
 * @returns `<contactId>.<signature>`.
 * @throws {Error} When UNSUBSCRIBE_SECRET is unset.
 */
function signToken(purpose: TokenPurpose, contactId: string): string {
  const secret = unsubscribeSecret();
  if (!secret) throw new Error("UNSUBSCRIBE_SECRET is not set");
  return `${contactId}.${sign(purpose, contactId, secret)}`;
}

/**
 * Checks a token against one purpose.
 * @param purpose - What the token must opt out of.
 * @param token - Token from the URL.
 * @returns The contact id it was signed for, or null when it is malformed, forged or
 *   signed for the other purpose.
 */
function verifyToken(purpose: TokenPurpose, token: string): string | null {
  const secret = unsubscribeSecret();
  if (!secret) return null;
  const [contactId, signature, extra] = token.split(".");
  if (!contactId || !signature || extra !== undefined || !CONTACT_ID_RE.test(contactId)) {
    return null;
  }
  const expected = Buffer.from(sign(purpose, contactId, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return null;
  return timingSafeEqual(expected, actual) ? contactId : null;
}

/**
 * Builds a contact's mailing-list unsubscribe token.
 * @param contactId - Contact id.
 * @returns `<contactId>.<signature>`.
 * @throws {Error} When UNSUBSCRIBE_SECRET is unset.
 */
export function signUnsubscribeToken(contactId: string): string {
  return signToken("unsubscribe", contactId);
}

/**
 * Checks a token from a mailing-list unsubscribe link.
 * @param token - Token from the URL.
 * @returns The contact id it was signed for, or null when it is malformed or forged.
 */
export function verifyUnsubscribeToken(token: string): string | null {
  return verifyToken("unsubscribe", token);
}

/**
 * Builds a contact's "stop asking me for reviews" token.
 * @param contactId - Contact id.
 * @returns `<contactId>.<signature>`.
 * @throws {Error} When UNSUBSCRIBE_SECRET is unset.
 */
export function signReviewAskStopToken(contactId: string): string {
  return signToken("review-asks", contactId);
}

/**
 * Checks a token from a review-ask stop link.
 * @param token - Token from the URL.
 * @returns The contact id it was signed for, or null when it is malformed or forged.
 */
export function verifyReviewAskStopToken(token: string): string | null {
  return verifyToken("review-asks", token);
}
