#!/usr/bin/env npx ts-node --project tsconfig.json
/**
 * @file reauth-google.ts
 * @description Re-authorise Google OAuth with Calendar + Contacts scopes and print the new refresh token.
 *
 * Run:  npx ts-node scripts/reauth-google.ts
 *
 * Then paste the new GOOGLE_OAUTH_REFRESH_TOKEN value into .env.local and Vercel env vars.
 */

import * as readline from "readline";
import * as dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config({ path: ".env.local" });

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;

if (!clientId || !clientSecret || !redirectUri) {
  console.error(
    "Missing env vars: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI",
  );
  process.exit(1);
}

const SCOPES = [
  // Calendar — read/write all calendars
  "https://www.googleapis.com/auth/calendar",
  // People API — read + write Google Contacts
  "https://www.googleapis.com/auth/contacts",
];

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // force consent screen so a refresh_token is always returned
  scope: SCOPES,
});

console.log("\n=== Google OAuth Re-authorisation ===\n");
console.log("1. Open this URL in your browser:\n");
console.log(`   ${authUrl}\n`);
console.log('2. Authorise the app, then copy the "code" from the redirect URL.');
console.log("   (The URL will look like: http://localhost/?code=4/0AXxxx...&scope=...)\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question(
  "3. Paste the full redirect URL (or just the code) and press Enter: ",
  async (input) => {
    rl.close();

    // Accept either the full redirect URL or just the bare code value
    let code = input.trim();
    try {
      const parsed = new URL(code);
      const fromParam = parsed.searchParams.get("code");
      if (fromParam) code = fromParam;
    } catch {
      // Not a URL — use as-is
    }

    try {
      const { tokens } = await oauth2Client.getToken(code);
      console.log("\n=== Success! ===\n");
      console.log("New refresh token:");
      console.log(`\n  GOOGLE_OAUTH_REFRESH_TOKEN="${tokens.refresh_token}"\n`);
      console.log("Steps:");
      console.log(
        "  1. Replace GOOGLE_OAUTH_REFRESH_TOKEN in your .env.local with the value above.",
      );
      console.log("  2. Update the same var in Vercel → Settings → Environment Variables.f");
      console.log("  3. Redeploy on Vercel (or restart your dev server).\n");
      if (!tokens.refresh_token) {
        console.warn(
          "WARNING: No refresh_token returned. This usually means the app was already authorised\n" +
            "without the 'consent' prompt. Revoke access at https://myaccount.google.com/permissions\n" +
            "and run this script again.\n",
        );
      }
    } catch (err) {
      console.error("Failed to exchange code for tokens:", err);
      process.exit(1);
    }
  },
);
