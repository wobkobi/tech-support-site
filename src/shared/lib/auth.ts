// src/shared/lib/auth.ts
/**
 * @file auth.ts
 * @description Shared authentication utilities for admin routes and pages.
 */

import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { notFound } from "next/navigation";

/**
 * Validates a token against ADMIN_SECRET using constant-time comparison.
 * @param token - Token to validate.
 * @returns True if the token matches ADMIN_SECRET.
 */
export function isValidAdminToken(token: string | null | undefined): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || !token) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  } catch {
    return false;
  }
}

/**
 * Validates the admin token from page searchParams, calling notFound() if invalid.
 * @param token - Token string from URL search params (may be undefined)
 * @returns The validated token string
 */
export function requireAdminToken(token: string | undefined): string {
  if (!isValidAdminToken(token ?? null)) notFound();
  return token!;
}

/**
 * Checks if a request has valid admin credentials via X-Admin-Secret header.
 * @param req - The incoming request.
 * @returns True if the request has valid admin credentials.
 */
export function isAdminRequest(req: NextRequest): boolean {
  return isValidAdminToken(req.headers.get("x-admin-secret"));
}

/**
 * Validates a Bearer token from an Authorization header against CRON_SECRET
 * using constant-time comparison.
 * @param authHeader - Raw Authorization header value (e.g. "Bearer xyz") or null.
 * @returns True if the token matches CRON_SECRET.
 */
function isValidCronBearer(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader) return false;
  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return false;
  const token = authHeader.slice(prefix.length);
  try {
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Validates cron authorization from Vercel Cron or secret token.
 * @param request - The incoming request to verify.
 * @returns True if authorized, false otherwise.
 */
export function isCronAuthorized(request: NextRequest): boolean {
  if (request.headers.has("x-vercel-cron")) return true;
  return isValidCronBearer(request.headers.get("authorization"));
}
