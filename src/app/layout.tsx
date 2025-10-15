// src/app/layout.tsx
/**
 * @file layout.tsx
 * @description
 * Root layout for the App Router. Injects global styles and persistent UI like the taskbar.
 */
import { Analytics } from "@vercel/analytics/next";
import { Viewport } from "next";
import { Exo } from "next/font/google";
import "./globals.css";

const exo = Exo({
  subsets: ["latin"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-geist-sans", // populates your var
});

export const metadata = {
  metadataBase: new URL("https://tothepointnz.vercel.app"),
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
  ],
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
  alternates: { canonical: "/" },
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
    icon: [
      { url: "/favicon-16x16.png?v=4", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png?v=4", type: "image/png", sizes: "32x32" },
      {
        url: "/android-chrome-192x192.png?v=4",
        type: "image/png",
        sizes: "192x192",
      },
      {
        url: "/android-chrome-512x512.png?v=4",
        type: "image/png",
        sizes: "512x512",
      },
      { url: "/favicon.ico?v=4" }, // optional
    ],
    apple: [{ url: "/apple-touch-icon.png?v=4", sizes: "180x180" }],
    shortcut: ["/favicon.ico?v=4"],
  },
  manifest: "/site.webmanifest",
};

// Viewport settings for responsive design, mobile-friendliness, and accessibility
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};
/**
 * RootLayout component that wraps the entire application.
 * @param root0 the props object.
 * @param root0.children - The child components to be rendered within the layout.
 * @returns The RootLayout component.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): React.ReactElement {
  return (
    <html lang="en" className={`${exo.variable} font-sans`}>
      <body suppressHydrationWarning>
        {/* <NavBar /> */}
        {children}
        <Analytics />
      </body>
    </html>
  );
}
