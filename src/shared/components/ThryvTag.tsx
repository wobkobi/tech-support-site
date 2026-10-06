"use client";
// src/shared/components/ThryvTag.tsx
// Loads the Thryv (Yellow) Marketing Center tag. Thryv's Tealium container
// (utag.js) installs Thryv's own Google Tag Manager container for their GA4
// reporting, and for visitors arriving from a Thryv ad (a `utm_campaign` like
// "x.123") swaps the shown phone number for a call-tracking number.

import { usePathname } from "next/navigation";
import Script from "next/script";
import type React from "react";
import { useEffect } from "react";

// Scoped to the Production environment on Vercel, so preview and local builds
// load no tag and test traffic never reaches Thryv's reports.
const THRYV_UID = process.env.NEXT_PUBLIC_THRYV_UID;

// Thryv's snippet, with the business ID injected. `Parameters.ExternalUid` must be
// set before utag.js runs its tags; Thryv's GTM tag polls for it for 5 seconds.
const loaderCode = `window.utag_data = window.utag_data || {};
window.Parameters = window.Parameters || { ExternalUid: ${JSON.stringify(THRYV_UID ?? "")} };
(function(a,b,c,d){a='https://tags.tiqcdn.com/utag/marketingcenter/common/prod/utag.js';
b=document;c='script';d=b.createElement(c);d.src=a;d.type='text/java'+c;d.async=true;
a=b.getElementsByTagName(c)[0];a.parentNode.insertBefore(d,a);})();`;

/**
 * Injects Thryv's tag on public pages. Renders nothing when NEXT_PUBLIC_THRYV_UID
 * is unset (dev, preview) or on /admin pages, so back-office browsing never
 * reaches Thryv's reports.
 * @returns The tag's loader script, or null when unconfigured or on admin pages.
 */
export function ThryvTag(): React.ReactElement | null {
  const pathname = usePathname();
  // Admin pages are operator-only; keep them out of analytics entirely.
  const isAdmin = pathname === "/admin" || pathname.startsWith("/admin/");

  // Same reason as GoogleTag: unmounting doesn't unload Thryv's GTM container, and its
  // GA4 tag fires a page_view on every history change. Thryv's tag publishes the GA4 ID
  // it picked as `window.measurementId`, so `ga-disable-<ID>` mutes those hits in /admin.
  useEffect(() => {
    const id = (window as unknown as { measurementId?: string }).measurementId;
    if (!id) return;
    (window as unknown as Record<string, boolean>)[`ga-disable-${id}`] = isAdmin;
  }, [isAdmin]);

  if (!THRYV_UID || isAdmin) return null;

  // lazyOnload keeps the container and everything it pulls in off the critical path.
  return (
    <Script id="thryv-tag" strategy="lazyOnload">
      {loaderCode}
    </Script>
  );
}
