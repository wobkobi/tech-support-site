// src/shared/lib/auth.ts
/**
 * @file auth.ts
 * @description Shared authentication utilities for admin routes and pages.
 */

import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";

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
 * Checks if a request has valid admin credentials via X-Admin-Secret header.
 * @param req - The incoming request.
 * @returns True if the request has valid admin credentials.
 */
export function isAdminRequest(req: NextRequest): boolean {
  return isValidAdminToken(req.headers.get("x-admin-secret"));
}

/**
 * Validates cron authorization from Vercel Cron or secret token.
 * @param request - The incoming request to verify.
 * @returns True if authorized, false otherwise.
 */
export function isCronAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // If no secret is configured, only allow from Vercel Cron
  if (!cronSecret) {
    return request.headers.has("x-vercel-cron");
  }

  // Check both Vercel Cron header and Bearer token
  return request.headers.has("x-vercel-cron") || authHeader === `Bearer ${cronSecret}`;
}
