// src/app/robots.ts
/**
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
        // Booking-flow, review-form and poster pages are deliberately NOT
        // disallowed here: they carry a noindex meta tag instead, and Google
        // only honours noindex on pages it is allowed to crawl. Blocking
        // them in robots.txt would freeze whatever Google last indexed.
        allow: ["/"],
        disallow: ["/admin", "/admin/", "/api/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
