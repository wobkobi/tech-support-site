// src/shared/lib/env.ts
/**
 * @description Required environment variable access plus a startup validation
 * pass. Most secrets in this app are read lazily and degrade gracefully (email
 * skips, calendar throws on first use), so only the handful the server cannot
 * run at all without are treated as fatal; the rest are warned about so a
 * misconfigured deploy is visible without taking the site down.
 */

/**
 * Secrets the server reads directly from process.env and cannot function
 * without. Missing one in production is a hard failure at boot; in other
 * environments it only warns so local dev and preview builds are not blocked.
 *
 * MONGODB_URI is included even though Prisma reads it from the schema datasource
 * itself: a blanked value (an unescaped `$` swallowed by dotenv-expand) would
 * otherwise surface only as a cryptic Prisma error on first query, so validating
 * it here catches it by name at boot. It is deliberately NOT asserted at the
 * Prisma client module scope - a throwing top-level side effect there breaks
 * page rendering in some module-eval contexts (Turbopack dev, cached loaders).
 */
const REQUIRED_ENV = ["MONGODB_URI", "ADMIN_SECRET", "CRON_SECRET"] as const;

/**
 * Feature-specific vars. A missing one disables or degrades the related feature
 * (booking calendar, email, AI estimates, travel distance, sheets sync) but is
 * never fatal, so these only ever warn.
 */
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
] as const;

/**
 * Reads a required environment variable, throwing a clear, named error when it
 * is absent or blank. Use this in place of `process.env.X!` so the failure
 * names the missing variable instead of surfacing as a downstream undefined.
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

/**
 * Validates the environment at startup. In production, any missing REQUIRED var
 * throws so a misconfigured deploy fails fast at boot rather than mid-request;
 * elsewhere it warns so local dev is not blocked. Missing RECOMMENDED vars
 * always warn only.
 */
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
 * Whether an env var is set and non-blank after trimming. The trim is what
 * catches a `$`-expansion silent-blank (a var present but empty).
 * @param name - Environment variable name.
 * @returns True when the value is non-empty.
 */
function isEnvPresent(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/**
 * Reports presence (never values) of every env var the app depends on, for the
 * authed health endpoint. Composed from the same REQUIRED_ENV / RECOMMENDED_ENV
 * sources the boot validation uses, so the list cannot drift.
 * @returns One entry per tracked var, required (database + secrets) first.
 */
export function getEnvReport(): EnvReportEntry[] {
  return [
    ...REQUIRED_ENV.map((name) => ({ name, required: true, present: isEnvPresent(name) })),
    ...RECOMMENDED_ENV.map((name) => ({ name, required: false, present: isEnvPresent(name) })),
  ];
}
