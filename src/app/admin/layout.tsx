// src/app/admin/layout.tsx
// Admin route segment layout. Sets `Referrer-Policy: no-referrer` so per-record customer
// tokens embedded in admin-rendered links (`cancelToken`, `reviewToken`) don't leak via
// the Referer header when the operator clicks through to external services - Google Drive
// PDFs, Maps links inside expanded booking cards, the "Back to site" link, etc. Renders no
// chrome; the sidebar and content column live in (shell)/layout.tsx, which the login page
// sits outside.

import type { Metadata } from "next";
import type React from "react";

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * Admin route-segment layout. The `app-admin` wrapper scopes the admin-only
 * rules in globals.css (touch-screen field sizing) to every `/admin/*` page,
 * login included.
 * @param props - Layout props.
 * @param props.children - Page content.
 * @returns Admin layout element.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <div className="app-admin">{children}</div>;
}
