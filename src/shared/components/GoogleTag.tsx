"use client";
// src/shared/components/GoogleTag.tsx
/**
 * @description Loads gtag.js for GA4 + Google Ads and reports tel: and
 * mailto: link taps.
 */

import { usePathname } from "next/navigation";
import Script from "next/script";
import type React from "react";
import { useEffect } from "react";

// Scoped to the Production environment on Vercel: preview and local builds see
// these undefined and load no tag, which keeps branch deploys out of the live
// property. Adding them to Preview would silently start reporting test traffic.
const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID;
const ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const CALL_LABEL = process.env.NEXT_PUBLIC_GOOGLE_ADS_CALL_LABEL;

// gtag.js loads once from any configured target; the per-target config calls
// register GA4 and Ads separately. Ads seeds the loader URL when present.
const loaderId = ADS_ID ?? GA4_ID;

/**
 * Injects the Google tag and reports phone-link taps as conversions and
 * email-link taps as GA4 events. Renders nothing when no measurement IDs are
 * set (dev, preview) or on /admin pages, so back-office browsing never
 * pollutes GA4/Ads data.
 * @returns The gtag script tags, or null when unconfigured or on admin pages.
 */
export function GoogleTag(): React.ReactElement | null {
  const pathname = usePathname();
  // Admin pages are operator-only; keep them out of analytics entirely.
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  // Unmounting does not unload gtag.js, and GA4 enhanced measurement reports a
  // page_view on every history change - so client-side navigation into /admin
  // would still send the admin path (which carries invoice and contact IDs).
  // The `ga-disable-<ID>` flag is checked per hit, so toggling it suppresses
  // those hits even though the tag is already live.
  useEffect(() => {
    if (!GA4_ID) return;
    (window as unknown as Record<string, boolean>)[`ga-disable-${GA4_ID}`] = isAdmin;
  }, [isAdmin]);

  // One delegated listener covers every tel: and mailto: link (raw anchors and
  // the Button component alike), so individual links never need their own
  // handler. Mirrors MetaPixel's Contact tracking on the Google side.
  useEffect(() => {
    if (!loaderId || isAdmin) return;
    /**
     * Reports a tel: link tap to GA4 (and to Ads when a call label is set), and
     * a mailto: link tap to GA4.
     * @param event - The bubbled document click.
     */
    const onClick = (event: MouseEvent): void => {
      const origin = event.target as HTMLElement | null;
      const link = origin?.closest?.('a[href^="tel:"], a[href^="mailto:"]');
      if (!(link instanceof HTMLAnchorElement) || typeof window.gtag !== "function") return;
      if (link.href.startsWith("mailto:")) {
        window.gtag("event", "email_click");
        return;
      }
      window.gtag("event", "phone_call_click");
      if (ADS_ID && CALL_LABEL) {
        window.gtag("event", "conversion", { send_to: `${ADS_ID}/${CALL_LABEL}` });
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [isAdmin]);

  if (!loaderId || isAdmin) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${loaderId}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {[
          "window.dataLayer = window.dataLayer || [];",
          "function gtag(){dataLayer.push(arguments);}",
          "gtag('js', new Date());",
          GA4_ID ? `gtag('config', '${GA4_ID}');` : "",
          ADS_ID ? `gtag('config', '${ADS_ID}');` : "",
        ]
          .filter(Boolean)
          .join("\n")}
      </Script>
    </>
  );
}
