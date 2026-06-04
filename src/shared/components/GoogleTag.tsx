"use client";
// src/shared/components/GoogleTag.tsx
/**
 * @file GoogleTag.tsx
 * @description Loads gtag.js for GA4 + Google Ads and reports tel: link taps.
 */

import Script from "next/script";
import { useEffect } from "react";
import type React from "react";

const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID;
const ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const CALL_LABEL = process.env.NEXT_PUBLIC_GOOGLE_ADS_CALL_LABEL;

// gtag.js loads once from any configured target; the per-target config calls
// register GA4 and Ads separately. Ads seeds the loader URL when present.
const loaderId = ADS_ID ?? GA4_ID;

/**
 * Injects the Google tag and reports phone-link taps as conversions. Renders
 * nothing when no measurement IDs are set, so the site runs untracked in dev
 * or before the Ads/GA4 IDs are configured.
 * @returns The gtag script tags, or null when unconfigured.
 */
export function GoogleTag(): React.ReactElement | null {
  // One delegated listener covers every tel: link (raw anchors and the Button
  // component alike), so individual links never need their own handler.
  useEffect(() => {
    if (!loaderId) return;
    /**
     * Reports a tel: link tap to GA4, and to Ads when a call label is set.
     * @param event - The bubbled document click.
     */
    const onClick = (event: MouseEvent): void => {
      const origin = event.target as HTMLElement | null;
      const link = origin?.closest?.('a[href^="tel:"]');
      if (!link || typeof window.gtag !== "function") return;
      window.gtag("event", "phone_call_click");
      if (ADS_ID && CALL_LABEL) {
        window.gtag("event", "conversion", { send_to: `${ADS_ID}/${CALL_LABEL}` });
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (!loaderId) return null;

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
