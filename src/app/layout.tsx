// src/app/layout.tsx
/**
 * @file layout.tsx
 * @description Root layout for the App Router. Injects global styles, metadata, and JSON-LD.
 */

import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Exo } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { NavBar } from "@/components/NavBar";

const exo = Exo({
  subsets: ["latin"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-geist-sans",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "To the Point Tech",
    template: "%s | To the Point Tech",
  },
  description:
    "Local tech support in Point Chevalier. Clear fixes, setup, Wi-Fi, email, backups, and more. Always straight to the point.",
  applicationName: "To the Point Tech",
  authors: [{ name: "Harrison Raynes" }],
  keywords: [
    "Tech Support",
    "IT Help",
    "Computer Help",
    "Wi-Fi",
    "Printer Setup",
    "Email",
    "Data Transfer",
    "Backups",
    "Point Chevalier",
    "Auckland",
    "New Zealand",
    "Computer Repair",
    "Laptop Repair",
    "PC Tune-Up",
    "Data Recovery",
    "Virus Removal",
    "Malware Cleanup",
    "Cybersecurity Check",
    "Scam Removal",
    "Software Install",
    "Operating System Help",
    "Windows Help",
    "macOS Help",
    "iPhone Help",
    "Android Help",
    "Slow Computer Fix",
    "Home IT Support",
    "Onsite Tech Support",
    "Remote Tech Support",
    "Wi-Fi Troubleshooting",
    "Home Network Setup",
    "Router Setup",
    "Parental Controls",
    "Cloud Backup Setup",
    "Photo Backup",
    "Phone Transfer",
    "Data Migration",
    "Email Troubleshooting",
    "Google Account Help",
    "Microsoft Account Help",
    "Smart TV Setup",
    "Streaming Setup",
    "Smart Home Setup",
    "Small Business IT Support",
    "Point Chev",
    "Pt Chev",
    "Point Chevalier Auckland",
    "Western Springs",
    "Auckland Zoo",
    "MOTAT",
    "Unitec Mount Albert",
    "Mount Albert",
    "Mt Albert",
    "Kingsland",
    "Morningside",
    "Grey Lynn",
    "Westmere",
    "Ponsonby",
    "Herne Bay",
    "Avondale",
    "Waterview",
    "New Lynn",
    "Blockhouse Bay",
    "Sandringham",
    "Mt Eden",
    "Epsom",
    "Newmarket",
    "Parnell",
    "Auckland CBD",
    "Central Auckland",
    "West Auckland",
    "North Shore",
    "Henderson",
    "Te Atatu",
    "Remuera",
    "Orakei",
    "Local Tech Support Auckland",
    "Mobile Tech Support Auckland",
    "Home IT Support Auckland",
  ],

  alternates: {
    canonical: "/",
    languages: { "en-NZ": "/" },
  },
  openGraph: {
    type: "website",
    locale: "en_NZ",
    siteName: "To the Point Tech",
    url: "/",
    title: "To the Point Tech",
    description: "For all your tech support needs. Always straight to the point.",
    images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "To the Point Tech" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "To the Point Tech",
    description: "For all your tech support needs. Always straight to the point.",
    images: ["/og.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    // Adaptive SVG + raster fallbacks with light/dark media
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      {
        url: "/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/favicon-32x32-dark.png",
        sizes: "32x32",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
      {
        url: "/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png",
        media: "(prefers-color-scheme: light)",
      },
      {
        url: "/favicon-16x16-dark.png",
        sizes: "16x16",
        type: "image/png",
        media: "(prefers-color-scheme: dark)",
      },
      { url: "/favicon.ico" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
    other: [
      {
        rel: "mask-icon",
        url: "/safari-pinned-tab.svg",
        color: "#0c0a3e",
        media: "(prefers-color-scheme: light)",
      },
      {
        rel: "mask-icon",
        url: "/safari-pinned-tab.svg",
        color: "#43bccd",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    shortcut: ["/favicon.ico"],
  },
  manifest: "/site.webmanifest",
};

// Viewport and theme colour (light/dark)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f8" }, // seasalt-500
    { media: "(prefers-color-scheme: dark)", color: "#001514" }, // rich-black-500
  ],
};

/**
 * Root layout component.
 * @param props - Layout props.
 * @param props.children - Content to render inside the layout.
 * @returns The RootLayout wrapper element.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: "To the Point Tech",
    url: siteUrl,
    image: `${siteUrl}/og.jpg`,
    description:
      "Local tech support in Point Chevalier, Auckland. Wi-Fi, email, backups, setup, and repairs.",
    areaServed: ["Point Chevalier", "Auckland", "New Zealand"],
    // Add contactPoint when you have a public phone/email you want indexed.
  };

  return (
    <html lang="en" className={`${exo.variable} font-sans`}>
      <body suppressHydrationWarning>
        {/* Primary app content */}
        <NavBar />
        {children}

        {/* Analytics */}
        <Analytics />

        {/* JSON-LD for richer SERP features */}
        <Script
          id="ld-org"
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
      </body>
    </html>
  );
}
