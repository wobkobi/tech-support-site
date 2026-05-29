// src/app/admin/layout.tsx
/**
 * @file layout.tsx
 * @description Admin route segment layout. Sets `Referrer-Policy: no-referrer`
 * so the admin token (which is currently embedded in the URL via `?token=...`)
 * isn't leaked via the Referer header when the operator clicks through to
 * external services - Google Drive PDFs, Maps links inside expanded booking
 * cards, the "Back to site" link, etc. Pure metadata wrapper; doesn't render
 * a sidebar or shell - those live in AdminPageLayout per-page.
 */

import type { Metadata } from "next";
import type React from "react";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * Admin route-segment layout. Renders children inside a fragment so the
 * metadata above applies to every page in `/admin/*`. No chrome here -
 * sidebar + content shell live in AdminPageLayout per-page.
 * @param props - Layout props.
 * @param props.children - Page content.
 * @returns Admin layout element.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <>{children}</>;
}
