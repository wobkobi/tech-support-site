// src/app/sitemap.ts
// Dynamic sitemap for search engines. Lists all crawlable public routes.

import { SERVICE_PAGE_SLUGS } from "@/shared/lib/service-pages";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { MetadataRoute } from "next";

const siteUrl = getSiteUrl();

/**
 * Generate sitemap entries for all public, indexable routes.
 * Admin, API, and email-preview routes are intentionally excluded, as are the noindex
 * pages (Search Console flags a submitted URL that is marked noindex).
 *
 * URLs only. Google ignores `changefreq` and `priority`, and it trusts `lastmod` only
 * when it is verifiably accurate - a made-up date (build time, start of month) teaches
 * it to ignore lastmod for the whole site, so none is sent until a real one exists.
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
