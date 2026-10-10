// src/app/admin/layout.tsx
// Admin route segment layout. Sets `Referrer-Policy: no-referrer` so per-record customer
// tokens embedded in admin-rendered links (`cancelToken`, `reviewToken`) don't leak via
// the Referer header when the operator clicks through to external services - Google Drive
// PDFs, Maps links inside expanded booking cards, the "Back to site" link, etc. Renders no
// chrome; the sidebar, top bar and content column live in AdminShell (rendered by
// (shell)/layout.tsx), which the login page sits outside.

import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import type React from "react";

// Body and figures face for the admin only: plainer than Exo at dense sizes, with even
// digits for money columns. Headings keep Exo (see the .app-admin rules in globals.css).
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-plex",
});

export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

/**
 * Admin route-segment layout. The `app-admin` wrapper scopes the admin-only
 * rules in globals.css (focus ring, touch-screen field sizing, scroll padding
 * under the top bar, phone action bars) to every `/admin/*` page, login included.
 * @param props - Layout props.
 * @param props.children - Page content.
 * @returns Admin layout element.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <div className={`app-admin ${plex.variable}`}>{children}</div>;
}
