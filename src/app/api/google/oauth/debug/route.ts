// src/app/api/google/oauth/debug/route.ts
/**
 * Debug route to verify GOOGLE_OAUTH_* env vars are loaded.
 */

import { NextResponse } from "next/server";

/**
 * Returns which env vars are present (not their values).
 * @returns JSON response.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    hasClientId: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID),
    hasClientSecret: Boolean(process.env.GOOGLE_OAUTH_CLIENT_SECRET),
    hasRedirectUri: Boolean(process.env.GOOGLE_OAUTH_REDIRECT_URI),
  });
}
