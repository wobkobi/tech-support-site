// src/shared/lib/site-url.ts
/**
 * @file site-url.ts
 * @description Single source of truth for the public site origin. Reads
 *   `NEXT_PUBLIC_SITE_URL` and falls back to the canonical www host so
 *   canonical tags, sitemap, robots, JSON-LD and email links all agree on
 *   one host. A host mismatch makes Google treat a page as a duplicate
 *   ("Alternative page with proper canonical tag").
 */

/** Canonical www origin used when `NEXT_PUBLIC_SITE_URL` is unset. */
const DEFAULT_SITE_URL = "https://www.tothepoint.co.nz";

/**
 * Resolve the public site origin, with any trailing slash stripped so
 * callers can append paths without doubling up the separator.
 * @returns The site origin, e.g. `https://www.tothepoint.co.nz`.
 */
export function getSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? DEFAULT_SITE_URL).replace(/\/$/, "");
}
