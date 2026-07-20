"use client";
// src/shared/components/MetaPixel.tsx
/**
 * @description Loads the Meta Pixel (fbevents.js), tracks PageView on load and
 * client-side route changes, and reports tel:/mailto: link taps as Contact events.
 */

import { usePathname } from "next/navigation";
import Script from "next/script";
import type React from "react";
import { useEffect, useRef } from "react";

const PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;

// The base snippet from Events Manager, with the pixel ID injected. fbevents.js
// self-fires PageView on the hard load; route-change PageViews are handled below.
const baseCode = `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init', '${PIXEL_ID}');fbq('track', 'PageView');`;

/**
 * Injects the Meta Pixel base code and keeps PageView in sync with App Router
 * navigation. Renders nothing when NEXT_PUBLIC_META_PIXEL_ID is unset, so the
 * site runs untracked in dev or before the pixel is configured. Also renders
 * nothing on /admin pages, so back-office browsing never reaches Meta.
 * @returns The pixel script tags, or null when unconfigured or on admin pages.
 */
export function MetaPixel(): React.ReactElement | null {
  const pathname = usePathname();
  // Admin pages are operator-only; keep them out of analytics entirely.
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");
  // The base snippet already fires PageView on first load; skip the initial
  // effect run so that view is not double-counted.
  const primed = useRef(false);

  // Report each App Router navigation as a fresh PageView - fbevents.js only
  // auto-fires on the hard page load, not on client-side route changes.
  useEffect(() => {
    // Prime on the very first run regardless of whether fbq has loaded yet: the
    // base snippet already fires PageView on the hard load, so this run is never
    // a real navigation. Priming before the fbq guard stops a not-yet-ready
    // pixel from swallowing the first client-side navigation's PageView.
    if (!primed.current) {
      primed.current = true;
      return;
    }
    if (!PIXEL_ID || isAdmin || typeof window.fbq !== "function") return;
    window.fbq("track", "PageView");
  }, [pathname, isAdmin]);

  // One delegated listener reports every phone (tel:) or email (mailto:) link
  // tap as a Contact event, mirroring how GoogleTag tracks phone clicks.
  useEffect(() => {
    if (!PIXEL_ID || isAdmin) return;
    /**
     * Reports a tel: or mailto: link tap to the Meta Pixel as a Contact event.
     * @param event - The bubbled document click.
     */
    const onClick = (event: MouseEvent): void => {
      const origin = event.target as HTMLElement | null;
      const link = origin?.closest?.('a[href^="tel:"], a[href^="mailto:"]');
      if (!link || typeof window.fbq !== "function") return;
      window.fbq("track", "Contact");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [isAdmin]);

  if (!PIXEL_ID || isAdmin) return null;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {baseCode}
      </Script>
      <noscript>
        {/* next/image needs client JS, so it cannot run inside <noscript>; this
            is a 1x1 tracking beacon for JS-disabled visitors, not a real image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}
