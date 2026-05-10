// src/shared/components/BreadcrumbJsonLd.tsx
/**
 * @file BreadcrumbJsonLd.tsx
 * @description Emits a BreadcrumbList JSON-LD script for the current page.
 *   Including breadcrumbs lets Google show a hierarchy in search results
 *   instead of just the bare URL.
 */

import type React from "react";
import Script from "next/script";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz";

export interface BreadcrumbCrumb {
  /** Human-readable name shown in the breadcrumb. */
  name: string;
  /** Path relative to the site root, e.g. "/services". Use "/" for Home. */
  path: string;
}

/**
 * BreadcrumbList JSON-LD emitter.
 * @param props - Component props.
 * @param props.crumbs - Ordered list of crumbs from root to current page.
 * @returns Script element with embedded JSON-LD.
 */
export function BreadcrumbJsonLd({
  crumbs,
}: {
  crumbs: ReadonlyArray<BreadcrumbCrumb>;
}): React.ReactElement {
  const json = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: `${siteUrl}${c.path === "/" ? "" : c.path}`,
    })),
  };

  return (
    <Script
      id={`ld-breadcrumb-${crumbs[crumbs.length - 1]?.path ?? "root"}`}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json) }}
    />
  );
}
