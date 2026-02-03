// src/app/api/google/oauth/callback/route.ts
/**
 * OAuth callback endpoint that exchanges code for tokens.
 * Prints the refresh token so you can copy it into env, then remove this route.
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
 * GET handler that exchanges auth code for tokens and shows the refresh token.
 * @param req Request object.
 * @returns HTML response containing refresh token (one-time use).
 */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "Missing code." }, { status: 400 });
  }

  const oauth2 = getOAuthClient();
  const { tokens } = await oauth2.getToken(code);

  const refreshToken = tokens.refresh_token ?? "";
  const accessToken = tokens.access_token ?? "";

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>OAuth Token</title></head>
<body style="font-family: ui-sans-serif, system-ui; padding: 24px;">
  <h1>Google OAuth tokens</h1>
  <p><strong>Refresh token</strong> (copy into GOOGLE_OAUTH_REFRESH_TOKEN):</p>
  <pre style="white-space: pre-wrap; word-break: break-all; padding: 12px; border: 1px solid #ccc;">${refreshToken}</pre>
  <p><strong>Access token</strong> (short lived, usually not needed):</p>
  <pre style="white-space: pre-wrap; word-break: break-all; padding: 12px; border: 1px solid #ccc;">${accessToken}</pre>
  <p>After you set the refresh token in env, delete these oauth helper routes.</p>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
