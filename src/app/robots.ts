// src/app/robots.ts
/**
 * @file robots.ts
 * @description robots.txt generator. Allows public routes, blocks admin/API/preview.
 */

import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz";

/**
 * Generate robots.txt rules.
 * @returns Robots configuration with sitemap reference.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
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
