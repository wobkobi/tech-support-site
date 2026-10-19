// src/shared/lib/env.ts
// Env access and startup validation. Only vars the server can't run without are fatal; the rest
// warn.

/**
 * Secrets the server can't run without; fatal in production, warnings elsewhere. MONGODB_URI is
 * checked here (not Prisma module scope) so a `$`-expansion blank fails by name.
 */
const REQUIRED_ENV = ["MONGODB_URI", "ADMIN_SECRET", "CRON_SECRET"] as const;

/** Feature vars; a missing one degrades its feature but only warns. */
const RECOMMENDED_ENV = [
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_REDIRECT_URI",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "BOOKING_CALENDAR_ID",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "ADMIN_EMAIL",
  "OPENAI_API_KEY",
  "GOOGLE_MAPS_SERVER_KEY",
  "HOME_ADDRESS",
  "GOOGLE_SHEET_ID",
  "GOOGLE_BUSINESS_SHEETS_FOLDER_ID",
  "UNSUBSCRIBE_SECRET",
  "BLOB_READ_WRITE_TOKEN",
  "META_PAGE_ID",
  "META_PAGE_ACCESS_TOKEN",
  "INSTAGRAM_ACCOUNT_ID",
  "GOOGLE_BUSINESS_ACCOUNT_ID",
  "GOOGLE_BUSINESS_LOCATION_ID",
] as const;

/**
 * Reads a required env var, throwing a named error when absent or blank (instead of `process.env.X!`).
 * @param name - The environment variable name.
 * @returns The trimmed, non-empty value.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing or empty required environment variable: ${name} - if the value contains "$", check .env / Vercel escaping (dotenv-expand blanks an unescaped $VAR).`,
    );
  }
  return value;
}

/** Validates env at startup: missing REQUIRED throws in production, else warns; RECOMMENDED always warns. */
export function validateEnv(): void {
  const missingRequired = REQUIRED_ENV.filter((name) => !process.env[name]?.trim());
  const missingRecommended = RECOMMENDED_ENV.filter((name) => !process.env[name]?.trim());

  if (missingRecommended.length > 0) {
    console.warn(
      `[env] Recommended vars not set (related features will be disabled): ${missingRecommended.join(", ")}`,
    );
  }

  if (missingRequired.length > 0) {
    const message = `[env] Missing required vars: ${missingRequired.join(
      ", ",
    )} - if a value contains "$", check .env / Vercel escaping (dotenv-expand blanks an unescaped $VAR)`;
    if (process.env.NODE_ENV === "production") {
      throw new Error(message);
    }
    console.warn(`${message} (allowed outside production)`);
  }
}

/** Presence snapshot for one env var - never carries the value itself. */
export interface EnvReportEntry {
  /** Environment variable name. */
  name: string;
  /** Whether a missing value is fatal (database + REQUIRED) vs feature-degrading (RECOMMENDED). */
  required: boolean;
  /** True when the var is set and non-blank after trimming. */
  present: boolean;
}

/**
 * Whether an env var is non-blank after trim, catching `$`-expansion blanks.
 * @param name - Environment variable name.
 * @returns True when the value is non-empty.
 */
function isEnvPresent(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/**
 * Presence (never values) of every tracked env var for the authed health endpoint, from the
 * same lists as boot validation.
 * @returns One entry per tracked var, required (database + secrets) first.
 */
export function getEnvReport(): EnvReportEntry[] {
  return [
    ...REQUIRED_ENV.map((name) => ({ name, required: true, present: isEnvPresent(name) })),
    ...RECOMMENDED_ENV.map((name) => ({ name, required: false, present: isEnvPresent(name) })),
  ];
}
