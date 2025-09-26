// src/app/layout.tsx
/**
 * @file layout.tsx
 * @description
 * Root layout for the App Router. Injects global styles and persistent UI like the taskbar.
 */
import { Analytics } from "@vercel/analytics/next";
import { Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "To the Point Tech",
  description: "site description goes here",
  authors: [{ name: "Harrison Raynes" }],
  keywords: ["Tech Support", "keyword2", "keyword3"],
  openGraph: {
    title: "To the Point Tech",
    description: "site description goes here",
    url: "https://www.yoursiteurl.com",
    locale: "en_NZ",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "site name goes here",
    description: "site description goes here",
  },
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
    <html lang="en">
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* <NavBar /> */}
        {children}
        <Analytics />
      </body>
    </html>
  );
}
