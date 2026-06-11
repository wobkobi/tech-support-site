// src/app/robots.ts
/**
 * @file robots.ts
 * @description robots.txt generator. Allows public routes, blocks admin/API/preview.
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
        // "/reviews" must be allowed explicitly: "Disallow: /review" is a
        // prefix match that would otherwise block the public reviews page
        // (the longer Allow rule wins under Google's precedence).
        allow: ["/", "/reviews"],
        disallow: [
          "/admin",
          "/admin/",
          "/api/",
          "/booking/edit",
          "/booking/cancel",
          "/booking/success",
          "/review",
          "/poster",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
