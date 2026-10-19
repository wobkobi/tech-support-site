// src/app/robots.ts
// robots.txt generator. Allows public routes, blocks the API only.

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
        // Private pages use noindex, not disallow: Google only honours noindex on
        // pages it may crawl. Only the API is blocked.
        allow: ["/"],
        disallow: ["/api/"],
      },
    ],
    // No `host`: Yandex-only, and Search Console flags it as ignored.
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
