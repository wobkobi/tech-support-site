// next.config.ts
import bundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";
import path from "node:path";

const isDev = process.env.NODE_ENV !== "production";

const cspProd =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' blob: https://maps.googleapis.com https://maps.gstatic.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "img-src 'self' data: blob: https://maps.googleapis.com https://maps.gstatic.com https://*.google.com https://*.gstatic.com; " +
  "font-src 'self' data: https://fonts.gstatic.com; " +
  "connect-src 'self' https://maps.googleapis.com; " +
  "worker-src 'self' blob:; " +
  "manifest-src 'self'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self';";

const cspDev =
  "default-src 'self' blob: data:; " +
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: https://maps.googleapis.com https://maps.gstatic.com https://va.vercel-scripts.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "img-src 'self' data: blob: https://maps.googleapis.com https://maps.gstatic.com https://*.google.com https://*.gstatic.com; " +
  "font-src 'self' data: https://fonts.gstatic.com; " +
  "connect-src 'self' ws: http://localhost:3000 http://127.0.0.1:3000 https://maps.googleapis.com https://va.vercel-scripts.com; " +
  "worker-src 'self' blob:; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self';";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  typescript: { ignoreBuildErrors: false },

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

  experimental: {
    optimizePackageImports: ["react-icons"],
  },

  serverExternalPackages: ["nodemailer"],
} satisfies NextConfig;

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

export default withBundleAnalyzer(nextConfig);
