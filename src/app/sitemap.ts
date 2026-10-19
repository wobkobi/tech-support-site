// src/app/sitemap.ts
// Dynamic sitemap for search engines. Lists all crawlable public routes.

import { SERVICE_PAGE_SLUGS } from "@/shared/lib/service-pages";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { MetadataRoute } from "next";

const siteUrl = getSiteUrl();

/**
 * Sitemap of public, indexable routes (noindex pages excluded). URLs only: a made-up
 * `lastmod` teaches Google to ignore it site-wide.
 * @returns Sitemap entries.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "/",
    "/services",
    ...SERVICE_PAGE_SLUGS.map((slug) => `/services/${slug}`),
    "/business",
    "/pricing",
    "/booking",
    "/about",
    "/contact",
    "/faq",
    "/reviews",
    "/privacy",
  ];

  return paths.map((path) => ({ url: `${siteUrl}${path}` }));
}
