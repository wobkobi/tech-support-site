// src/app/sitemap.ts
/**
 * @description Dynamic sitemap for search engines. Lists all crawlable public routes.
 */

import { getSiteUrl } from "@/shared/lib/site-url";
import type { MetadataRoute } from "next";

const siteUrl = getSiteUrl();

/**
 * Generate sitemap entries for all public, indexable routes.
 * Admin, API, and email-preview routes are intentionally excluded.
 * @returns Sitemap entries.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  // Use the start of the current UTC month as a stable lastModified for pages
  // that rarely change; stops crawlers seeing "modified today" every fetch.
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const routes: Array<{
    path: string;
    priority: number;
    changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
    lastModified: Date;
  }> = [
    { path: "/", priority: 1.0, changeFrequency: "weekly", lastModified: now },
    { path: "/services", priority: 0.9, changeFrequency: "monthly", lastModified: monthStart },
    { path: "/business", priority: 0.9, changeFrequency: "monthly", lastModified: monthStart },
    { path: "/pricing", priority: 0.9, changeFrequency: "monthly", lastModified: now },
    { path: "/booking", priority: 0.9, changeFrequency: "weekly", lastModified: now },
    { path: "/about", priority: 0.7, changeFrequency: "monthly", lastModified: monthStart },
    { path: "/contact", priority: 0.8, changeFrequency: "monthly", lastModified: monthStart },
    { path: "/faq", priority: 0.7, changeFrequency: "monthly", lastModified: monthStart },
    { path: "/reviews", priority: 0.7, changeFrequency: "weekly", lastModified: now },
    { path: "/privacy", priority: 0.3, changeFrequency: "yearly", lastModified: monthStart },
  ];

  return routes.map(({ path, priority, changeFrequency, lastModified }) => ({
    url: `${siteUrl}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
