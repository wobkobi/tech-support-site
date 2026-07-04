// src/app/robots.ts
/**
 * @description robots.txt generator. Allows public routes, blocks the API only.
 */

import { getSiteUrl } from "@/shared/lib/site-url";
import type { MetadataRoute } from "next";

const siteUrl = getSiteUrl();

/**
 * Generate robots.txt rules.
 * @returns Robots configuration with sitemap reference.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // Admin, booking-flow, review-form and poster pages are deliberately
        // NOT disallowed here: they carry a noindex meta tag instead, and
        // Google only honours noindex on pages it is allowed to crawl. Blocking
        // /admin in robots.txt would let a bare, linked /admin URL still get
        // index (URL-only) since the crawler could never fetch the noindex.
        // Only the API (never a search surface) is blocked outright.
        allow: ["/"],
        disallow: ["/api/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
