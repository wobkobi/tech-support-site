// src/app/layout.tsx
/**
 * @file layout.tsx
 * @description Root layout for the App Router. Injects global styles, metadata, and JSON-LD.
 */

import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata, Viewport } from "next";
import { Exo } from "next/font/google";
import "./globals.css";
import { NavBar } from "@/shared/components/NavBar";
import { PromoBanner } from "@/shared/components/PromoBanner";

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
    default: "To The Point Tech - Computer & IT Support in Auckland",
    template: "%s | To The Point Tech",
  },
  description:
    "Friendly computer and IT support across Auckland. On-site and remote help with PCs, Macs, Wi-Fi, phones, printers and more. Same-day, evening and weekend appointments. No jargon, no upselling, transparent pricing.",
  keywords: [
    "computer repair Auckland",
    "IT support Auckland",
    "tech support Auckland",
    "Wi-Fi setup Auckland",
    "laptop repair Auckland",
    "Mac support Auckland",
    "PC support Auckland",
    "small business IT support Auckland",
    "remote tech support NZ",
    "home computer help Auckland",
    "printer setup Auckland",
    "smart TV setup Auckland",
    "data recovery Auckland",
    "virus removal Auckland",
    "Auckland computer help",
    "Auckland IT help",
    "tech support near me Auckland",
    "computer technician Auckland",
    "on-site IT support Auckland",
    "mobile tech support Auckland",
  ],
  applicationName: "To The Point Tech",
  authors: [{ name: "Harrison Raynes" }],
  creator: "Harrison Raynes",
  publisher: "To The Point Tech",
  category: "Technology",
  alternates: {
    canonical: "/",
    languages: { "en-NZ": "/" },
  },
  openGraph: {
    type: "website",
    locale: "en_NZ",
    siteName: "To The Point Tech",
    url: "/",
    title: "To The Point Tech - Computer & IT Support in Auckland",
    description:
      "Friendly computer and IT support across Auckland. On-site and remote help, transparent pricing, no jargon.",
    images: [{ url: "/og-1200x630.jpg", width: 1200, height: 630, alt: "To The Point Tech" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "To The Point Tech - Computer & IT Support in Auckland",
    description:
      "Friendly computer and IT support across Auckland. On-site and remote help, transparent pricing, no jargon.",
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
  const servedSuburbs = [
    "Auckland Central",
    "Auckland CBD",
    "Ponsonby",
    "Herne Bay",
    "Grey Lynn",
    "Westmere",
    "Point Chevalier",
    "Western Springs",
    "Mount Albert",
    "Kingsland",
    "Sandringham",
    "Mount Eden",
    "Epsom",
    "Newmarket",
    "Parnell",
    "Remuera",
    "Mission Bay",
    "Saint Heliers",
    "Glen Innes",
    "Onehunga",
    "Royal Oak",
    "Hillsborough",
    "Three Kings",
    "Mount Roskill",
    "Avondale",
    "New Lynn",
    "Henderson",
    "Te Atatu",
    "Massey",
    "Glen Eden",
    "Titirangi",
    "Devonport",
    "Takapuna",
    "Milford",
    "Northcote",
    "Birkenhead",
    "Albany",
    "Manukau",
    "Botany",
    "Howick",
    "Pakuranga",
  ];

  const localBusinessJsonLd = {
    "@context": "https://schema.org",
    "@type": ["LocalBusiness", "ProfessionalService"],
    "@id": `${siteUrl}#business`,
    name: "To The Point Tech",
    legalName: "To The Point Tech",
    alternateName: ["To The Point Tech Auckland", "To The Point IT Support"],
    url: siteUrl,
    image: `${siteUrl}/og-1200x630.jpg`,
    logo: `${siteUrl}/source/logo-full.svg`,
    description:
      "Friendly computer and IT support across Auckland. On-site and remote help with PCs, Macs, Wi-Fi, phones, printers, smart TVs, and small-business IT. Same-day, evening and weekend appointments.",
    slogan: "Clear explanations, no jargon, solutions that actually work.",
    telephone: "+64-21-297-1237",
    email: "harrison@tothepoint.co.nz",
    founder: { "@type": "Person", name: "Harrison Raynes" },
    address: {
      "@type": "PostalAddress",
      addressLocality: "Point Chevalier",
      addressRegion: "Auckland",
      postalCode: "1022",
      addressCountry: "NZ",
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: -36.8717,
      longitude: 174.7185,
    },
    areaServed: [
      {
        "@type": "GeoCircle",
        geoMidpoint: { "@type": "GeoCoordinates", latitude: -36.8485, longitude: 174.7633 },
        geoRadius: "25000",
      },
      ...servedSuburbs.map((name) => ({
        "@type": "City",
        name,
        containedInPlace: { "@type": "AdministrativeArea", name: "Auckland" },
      })),
    ],
    serviceArea: {
      "@type": "GeoCircle",
      geoMidpoint: { "@type": "GeoCoordinates", latitude: -36.8717, longitude: 174.7185 },
      geoRadius: "15000",
    },
    openingHoursSpecification: [
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        opens: "08:00",
        closes: "20:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: ["Saturday", "Sunday"],
        opens: "09:00",
        closes: "18:00",
      },
    ],
    contactPoint: [
      {
        "@type": "ContactPoint",
        telephone: "+64-21-297-1237",
        email: "harrison@tothepoint.co.nz",
        contactType: "customer support",
        areaServed: "NZ",
        availableLanguage: ["English"],
      },
    ],
    priceRange: "NZ$65 - NZ$85 per hour",
    paymentAccepted: ["Cash", "Bank Transfer"],
    currenciesAccepted: "NZD",
    knowsAbout: [
      "Computer Repair",
      "Laptop Repair",
      "Wi-Fi Setup",
      "Network Troubleshooting",
      "Virus and Malware Removal",
      "Data Recovery",
      "Data Transfer",
      "Cloud Backup",
      "Smart Home Setup",
      "Smart TV Setup",
      "Printer Setup",
      "Email Configuration",
      "Account Recovery",
      "Windows Support",
      "macOS Support",
      "iOS Support",
      "Android Support",
      "Small Business IT",
      "Remote Tech Support",
    ],
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Tech Support Services",
      itemListElement: [
        {
          name: "Computer & Laptop Repair",
          description:
            "Diagnosis and repair for slow PCs and laptops, software issues, hardware faults and tune-ups.",
        },
        {
          name: "Wi-Fi & Network Setup",
          description:
            "Reliable Wi-Fi, mesh installs, dead-spot fixes, router configuration and speed troubleshooting.",
        },
        {
          name: "Phone & Tablet Help",
          description:
            "iPhone, iPad and Android setup, account sync, app help, and migrating to a new device.",
        },
        {
          name: "Virus & Malware Removal",
          description:
            "Scam pop-up cleanup, malware removal, and security hardening so your devices stay safe.",
        },
        {
          name: "Data Recovery & Transfer",
          description:
            "Recovering files from failing drives, migrating data between devices, and restoring backups.",
        },
        {
          name: "Cloud & Photo Backup",
          description:
            "OneDrive, iCloud and Google Photos setup with automatic backup of important files and photos.",
        },
        {
          name: "Smart TV & Home Setup",
          description:
            "Smart TVs, streaming apps, AirPlay/Chromecast, smart lights, cameras and voice assistants.",
        },
        {
          name: "Email & Account Setup",
          description:
            "Email configuration, password recovery, account sync across devices, and spam filtering.",
        },
        {
          name: "Printer Setup",
          description:
            "Printer install, network printing, driver troubleshooting and scan-to-email setup.",
        },
        {
          name: "Remote Support",
          description:
            "Quick remote help for software issues, account problems and follow-up support.",
        },
      ].map((s) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: s.name,
          description: s.description,
          areaServed: "Auckland, NZ",
        },
        priceCurrency: "NZD",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: 65,
          priceCurrency: "NZD",
          unitCode: "HUR",
        },
      })),
    },
    sameAs: ["https://www.google.com/search?q=To+The+Point+Tech+Auckland"],
  };

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl}#website`,
    url: siteUrl,
    name: "To The Point Tech",
    publisher: { "@id": `${siteUrl}#business` },
    inLanguage: "en-NZ",
  };

  return (
    <html lang="en" className={`${exo.variable} font-sans`}>
      <body suppressHydrationWarning>
        <PromoBanner />
        <NavBar />
        {children}

        <Analytics />
        <SpeedInsights />
        <script
          id="ld-business"
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }}
        />
        <script
          id="ld-website"
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
      </body>
    </html>
  );
}
