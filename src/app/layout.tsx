// src/app/layout.tsx
/**
 * @file layout.tsx
 * @description Root layout for the App Router. Injects global styles, metadata, and JSON-LD.
 */

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata, Viewport } from "next";
import { Exo } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { NavBar } from "@/shared/components/NavBar";

const exo = Exo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-geist-sans",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "To The Point Tech - Local IT & Computer Support Auckland",
    template: "%s | To The Point Tech",
  },
  description:
    "Local IT & computer support in Auckland. Same-day, evening & weekend appointments available. No jargon - clear fixes for computers, Wi-Fi, phones, printers, and more.",
  applicationName: "To The Point Tech",
  authors: [{ name: "Harrison Raynes" }],
  alternates: {
    canonical: "/",
    languages: { "en-NZ": "/" },
  },
  openGraph: {
    type: "website",
    locale: "en_NZ",
    siteName: "To The Point Tech",
    url: "/",
    title: "To The Point Tech",
    description:
      "Local tech support in Point Chevalier. Clear explanations, no jargon, and solutions that actually work.",
    images: [{ url: "/og-1200x630.jpg", width: 1200, height: 630, alt: "To The Point Tech" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "To The Point Tech",
    description:
      "Local tech support in Point Chevalier. Clear explanations, no jargon, and solutions that actually work.",
    images: ["/og-1200x630.jpg"],
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
    // Raster favicons with light/dark media
    icon: [
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
  },
  manifest: "/site.webmanifest",
};

// Viewport and theme colour (light/dark)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f8" }, // seasalt-500
    { media: "(prefers-color-scheme: dark)", color: "#001514" }, // rich-black-500
  ],
  colorScheme: "light",
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
    name: "To The Point Tech",
    url: siteUrl,
    image: `${siteUrl}/og-1200x630.jpg`,
    description:
      "Local IT & computer support in Auckland. Same-day, evening & weekend appointments. No jargon - clear fixes for computers, Wi-Fi, phones, printers, and more.",
    telephone: "+64-21-297-1237",
    email: "harrison@tothepoint.co.nz",
    founder: { "@type": "Person", name: "Harrison Raynes" },
    address: {
      "@type": "PostalAddress",
      addressLocality: "Point Chevalier",
      addressRegion: "Auckland",
      addressCountry: "NZ",
    },
    areaServed: {
      "@type": "GeoCircle",
      geoMidpoint: { "@type": "GeoCoordinates", latitude: -36.8717, longitude: 174.7185 },
      geoRadius: "15000",
    },
    contactPoint: {
      "@type": "ContactPoint",
      telephone: "+64-21-297-1237",
      email: "harrison@tothepoint.co.nz",
      contactType: "customer support",
      availableLanguage: "English",
    },
    priceRange: "$$",
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Tech Support Services",
      itemListElement: [
        "Computer & Laptop Repair",
        "Wi-Fi & Network Setup",
        "Phone & Tablet Help",
        "Virus & Malware Removal",
        "Data Recovery & Transfer",
        "Cloud & Photo Backup",
        "Smart TV & Home Setup",
        "Email & Account Setup",
        "Printer Setup",
        "Remote Support",
      ].map((name) => ({ "@type": "Offer", itemOffered: { "@type": "Service", name } })),
    },
  };

  return (
    <html lang="en" className={`${exo.variable} font-sans`}>
      <body suppressHydrationWarning>
        {/* Primary app content */}
        <NavBar />
        {children}

        {/* Analytics */}
        <Analytics />

        {/* Performance */}
        {/* Vercel performance and analytics integrations */}
        <SpeedInsights />
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
