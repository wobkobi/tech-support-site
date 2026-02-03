// src/app/api/google/oauth/start/route.ts
/**
 * Starts the Google OAuth flow for Calendar access.
 */

import { NextResponse } from "next/server";
import { google } from "googleapis";

/**
 * Build OAuth client from env vars.
 * @returns OAuth2 client.
 */
function getOAuthClient(): InstanceType<typeof google.auth.OAuth2> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing GOOGLE_OAUTH_* env vars.");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * GET handler that redirects to Google authorisation page.
 * @returns Redirect response to Google.
 */
export async function GET(): Promise<NextResponse> {
  const oauth2 = getOAuthClient();

  const url = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
  });

  return NextResponse.redirect(url);
}
