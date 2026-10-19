// src/shared/lib/site-url.ts
// The public site origin, so canonicals, sitemap, JSON-LD and emails agree on one host; a mismatch
// makes Google treat pages as duplicates.

/** Canonical www origin used when `NEXT_PUBLIC_SITE_URL` is unset. */
const DEFAULT_SITE_URL = "https://www.tothepoint.co.nz";

/**
 * The public site origin without a trailing slash.
 * @returns The site origin, e.g. `https://www.tothepoint.co.nz`.
 */
export function getSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL).replace(/\/$/, "");
}
