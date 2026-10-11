// src/shared/components/ThryvTag.tsx
// Loads the Thryv (Yellow) Marketing Center tag. Thryv's Tealium container
// (utag.js) installs Thryv's own Google Tag Manager container for their GA4
// reporting, and for visitors arriving from a Thryv ad (a `utm_campaign` like
// "x.123") swaps the shown phone number for a call-tracking number.

import { ThryvAdminMute } from "@/shared/components/ThryvTagClient";
import type React from "react";

// Scoped to the Production environment on Vercel, so preview and local builds
// load no tag and test traffic never reaches Thryv's reports.
const THRYV_UID = process.env.NEXT_PUBLIC_THRYV_UID;

// Thryv's snippet, with the business ID injected. `Parameters.ExternalUid` must be
// set before utag.js runs its tags; Thryv's GTM tag polls for it for 5 seconds.
// utag.js is injected after window load so the container and everything it pulls
// in stays off the critical path, and never on /admin pages so back-office
// browsing stays out of Thryv's reports.
const loaderCode = `window.utag_data = window.utag_data || {};
window.Parameters = window.Parameters || { ExternalUid: ${JSON.stringify(THRYV_UID ?? "")} };
(function(){if(/^\\/admin(\\/|$)/.test(location.pathname))return;
function load(){(function(a,b,c,d){a='https://tags.tiqcdn.com/utag/marketingcenter/common/prod/utag.js';
b=document;c='script';d=b.createElement(c);d.src=a;d.type='text/java'+c;d.async=true;
a=b.getElementsByTagName(c)[0];a.parentNode.insertBefore(d,a);})();}
if(document.readyState==='complete')load();else window.addEventListener('load',load);})();`;

/**
 * Renders Thryv's snippet as a plain inline script, so it sits in the server HTML
 * before </body> where Thryv's website check looks for it. Renders nothing when
 * NEXT_PUBLIC_THRYV_UID is unset (dev, preview).
 * @returns The tag's loader script, or null when unconfigured.
 */
export function ThryvTag(): React.ReactElement | null {
  if (!THRYV_UID) return null;

  return (
    <>
      <script id="thryv-tag" dangerouslySetInnerHTML={{ __html: loaderCode }} />
      <ThryvAdminMute />
    </>
  );
}
