// src/app/admin/layout.tsx
// Admin route segment layout. `Referrer-Policy: no-referrer` keeps customer tokens in admin
// links from leaking to external sites. No chrome; that's AdminShell in (shell)/layout.tsx.

import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import type React from "react";

// Admin body font: plainer than Exo at dense sizes, with even digits. Headings keep Exo.
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
 * Admin route-segment layout; `app-admin` scopes the admin-only globals.css rules.
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
