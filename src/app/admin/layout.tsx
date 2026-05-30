// src/app/admin/layout.tsx
/**
 * @file layout.tsx
 * @description Admin route segment layout. Sets `Referrer-Policy: no-referrer`
 * so no admin path leaks to external services via the Referer header when
 * the operator clicks through to Google Drive PDFs, Maps links inside
 * expanded booking cards, the "Back to site" link, etc. Originally added to
 * protect the URL-embedded admin token; now redundant for that purpose
 * (cookie-session auth, no token in URL) but kept as defence-in-depth so
 * customer/booking tokens in nested links (cancelToken, reviewToken) also
 * don't leak. Pure metadata wrapper; doesn't render a sidebar or shell -
 * those live in AdminPageLayout per-page.
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
