// src/app/admin/layout.tsx
// Admin route segment layout. `Referrer-Policy: no-referrer` keeps customer tokens in admin
// links from leaking to external sites. No chrome; that's AdminShell in (shell)/layout.tsx.

import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import type React from "react";

// Admin body font: plainer than Exo at dense sizes, with even digits. Headings keep Exo.
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-plex",
});

// The admin manifest sits here, not in (shell), so /admin/login links it too: a logged-out
// installed app lands there, and installing from it should still open the admin.
export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
  manifest: "/admin.webmanifest",
  appleWebApp: { title: "TTP Admin" },
};

// The admin is light-only, so one colour that runs into the white top bar replaces the
// public site's light/dark pair.
export const viewport: Viewport = {
  themeColor: "#ffffff",
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
