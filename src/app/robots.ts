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
        // Admin, booking, review and poster pages are deliberately NOT disallowed: they
        // carry noindex instead, and Google only honours noindex on pages it is allowed
        // to crawl - blocking them here would leave a linked URL indexed URL-only. Only
        // the API, never a search surface, is blocked outright.
        allow: ["/"],
        disallow: ["/api/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
