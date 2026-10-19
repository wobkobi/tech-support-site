// src/shared/components/ThryvTag.tsx
// Loads the Thryv Marketing Center tag, which installs Thryv's GTM container and swaps in a
// call-tracking number for visitors from a Thryv ad.

import { ThryvAdminMute } from "@/shared/components/ThryvTagClient";
import type React from "react";

// Scoped to the Production environment on Vercel, so preview and local builds
// load no tag and test traffic never reaches Thryv's reports.
const THRYV_UID = process.env.NEXT_PUBLIC_THRYV_UID;

// Thryv's snippet with the business ID. `Parameters.ExternalUid` must exist before utag.js runs
// (Thryv's GTM polls 5s). utag.js loads after window load and never on /admin.
const loaderCode = `window.utag_data = window.utag_data || {};
window.Parameters = window.Parameters || { ExternalUid: ${JSON.stringify(THRYV_UID ?? "")} };
(function(){if(/^\\/admin(\\/|$)/.test(location.pathname))return;
function load(){(function(a,b,c,d){a='https://tags.tiqcdn.com/utag/marketingcenter/common/prod/utag.js';
b=document;c='script';d=b.createElement(c);d.src=a;d.type='text/java'+c;d.async=true;
a=b.getElementsByTagName(c)[0];a.parentNode.insertBefore(d,a);})();}
if(document.readyState==='complete')load();else window.addEventListener('load',load);})();`;

/**
 * Renders Thryv's snippet as a plain inline script in the server HTML, where Thryv's site check
 * looks. Nothing when NEXT_PUBLIC_THRYV_UID is unset.
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
