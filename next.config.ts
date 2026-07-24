// next.config.ts
import bundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";
import path from "node:path";

const isDev = process.env.NODE_ENV !== "production";

const cspProd =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' blob: https://maps.googleapis.com https://maps.gstatic.com https://www.googletagmanager.com https://connect.facebook.net; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "img-src 'self' data: blob: https://maps.googleapis.com https://maps.gstatic.com https://*.google.com https://*.gstatic.com https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://googleads.g.doubleclick.net https://www.facebook.com; " +
  "font-src 'self' data: https://fonts.gstatic.com; " +
  // analytics.google.com (apex) and www.google.com are both required: gtag posts
  // GA4 hits to the bare analytics.google.com host, which the *.analytics.google.com
  // wildcard does NOT cover (CSP wildcards match subdomains, not the apex), and
  // sends the Google Signals collect hit to www.google.com.
  "connect-src 'self' https://maps.googleapis.com https://places.googleapis.com https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://www.google.com https://googleads.g.doubleclick.net https://stats.g.doubleclick.net https://connect.facebook.net https://www.facebook.com; " +
  "worker-src 'self' blob:; " +
  "manifest-src 'self'; " +
  "object-src 'none'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self';";

const cspDev =
  "default-src 'self' blob: data:; " +
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: https://maps.googleapis.com https://maps.gstatic.com https://va.vercel-scripts.com https://www.googletagmanager.com https://connect.facebook.net; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "img-src 'self' data: blob: https://tothepoint.co.nz https://www.tothepoint.co.nz https://maps.googleapis.com https://maps.gstatic.com https://*.google.com https://*.gstatic.com https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://googleads.g.doubleclick.net https://www.facebook.com; " +
  "font-src 'self' data: https://fonts.gstatic.com; " +
  "connect-src 'self' ws: http://localhost:3000 http://127.0.0.1:3000 https://maps.googleapis.com https://places.googleapis.com https://va.vercel-scripts.com https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://analytics.google.com https://*.analytics.google.com https://www.google.com https://googleads.g.doubleclick.net https://stats.g.doubleclick.net https://connect.facebook.net https://www.facebook.com; " +
  "worker-src 'self' blob:; " +
  "object-src 'none'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self';";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Drop the X-Powered-By: Next.js header so responses don't advertise the framework/version.
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: false },

  // Expose GOOGLE_MAPS_API_KEY to both server and client without the NEXT_PUBLIC_ prefix.
  env: {
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? "",
  },

  // Silence "inferred workspace root" warning + skip Next.js polyfills for modern browsers
  turbopack: {
    root: path.resolve(__dirname),
    resolveAlias: {
      // All APIs polyfilled here are natively supported by our browserslist targets
      // (Chrome 93+, Firefox 92+, Safari 15.4+, Edge 93+). Replacing with an empty
      // module removes ~14 KiB of flagged-but-never-executed legacy JS from the bundle.
      "next/dist/build/polyfills/polyfill-module": path.resolve(
        __dirname,
        "src/empty-polyfills.js",
      ),
    },
  },

  /**
   * Security headers for every route.
   * Sets clickjacking, MIME-sniffing, referrer, permissions, and CSP
   * (CSP switches between dev and prod variants).
   * @returns Header rules applied to all paths.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "Content-Security-Policy", value: isDev ? cspDev : cspProd },
        ],
      },
      // Cache static assets in /source/ for 30 days (they are not hash-named)
      {
        source: "/source/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=2592000, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },

  images: {
    formats: ["image/avif", "image/webp"],
  },

  experimental: {
    optimizePackageImports: ["react-icons"],
  },

  serverExternalPackages: ["nodemailer"],
} satisfies NextConfig;

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

export default withBundleAnalyzer(nextConfig);
