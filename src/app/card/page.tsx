// src/app/card/page.tsx
// Business card artwork - 90x55mm at 300 DPI (1063x650px), the standard NZ card size.
// Pass ?side=back for the contact face (default is the brand face), and ?mode=print to
// add a 3mm bleed on all edges (viewport 1134x721px). Contact details come from the live
// identity settings so the card cannot drift from the site, invoices and emails.
//
// Deliberately plain: a flat white ground, no backdrop photo and no frosted panel. At
// 90mm the site's blurred backdrop reads as muddy tone rather than imagery, and white
// keeps the small type crisp on uncoated stock. Grouping is done with spacing rather than
// rules - the wordmark already carries a vertical coquelicot rule, and a second one
// anywhere on the card reads as a stray piece of the logo.

import { getSettings } from "@/shared/lib/settings/get-settings";
import type { IdentitySettings } from "@/shared/lib/settings/types";
import type { Metadata } from "next";
import Image from "next/image";
import type React from "react";
import { FaEnvelope, FaGlobe, FaPhone } from "react-icons/fa6";

// Print artwork source, not a web page: keep it out of search results.
export const metadata: Metadata = {
  title: "Business card",
  robots: { index: false, follow: false },
};

/** What the card says it does, in the same plain register as the site copy. */
const TAGLINE = "Computer and tech support";

/** Service area, set below the contact triad rather than beside a pin icon. */
const SERVICE_AREA = "On-site across Auckland, or remote";

/**
 * Quiet zone held around the QR, in CSS pixels at 300 DPI. The generated SVG
 * carries a 10px margin on a 2000px canvas, well under the four modules the QR
 * spec wants, so the clear space has to come from the layout instead.
 */
const QR_QUIET_ZONE = 30;

/**
 * One contact line: brand-navy icon, then the value at a size that stays
 * readable for the site's older customers.
 * @param props - Component props.
 * @param props.icon - Icon component to render ahead of the value.
 * @param props.value - Contact value (phone, email or website).
 * @returns The contact row element.
 */
function ContactRow({
  icon: Icon,
  value,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  value: string;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-5">
      <Icon className="size-10.5 shrink-0 text-russian-violet" aria-hidden />
      <span className="text-[44px] leading-none font-semibold text-russian-violet">{value}</span>
    </div>
  );
}

/**
 * Brand face: wordmark, rule, operator name, and what the business does.
 * @param props - Component props.
 * @param props.identity - Live business identity settings.
 * @returns The front face element.
 */
function CardFront({ identity }: { identity: IdentitySettings }): React.ReactElement {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-11 text-center">
      {/* Wordmark doubles as the document's top-level heading for a11y. */}
      <h1 className="sr-only">
        {identity.company} - {TAGLINE} in Auckland
      </h1>
      <Image
        src="/source/logo-full.svg"
        alt={identity.company}
        width={825}
        height={278}
        priority
        className="h-auto w-206.25"
      />

      <div className="flex flex-col gap-2.5">
        <p className="text-[50px] leading-none font-bold text-russian-violet">{identity.name}</p>
        <p className="text-[40px] leading-none font-medium text-russian-violet">{TAGLINE}</p>
      </div>
    </div>
  );
}

/**
 * Contact face: the three ways to reach Harrison, the service area, and a QR to
 * the booking page.
 * @param props - Component props.
 * @param props.identity - Live business identity settings.
 * @returns The back face element.
 */
function CardBack({ identity }: { identity: IdentitySettings }): React.ReactElement {
  return (
    <div className="flex w-full items-center justify-between gap-10">
      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-6.5">
          <ContactRow icon={FaPhone} value={identity.phone} />
          <ContactRow icon={FaEnvelope} value={identity.email} />
          <ContactRow icon={FaGlobe} value={identity.website} />
        </div>

        <p className="text-[37px] leading-none font-medium text-russian-violet">{SERVICE_AREA}</p>
      </div>

      <div className="flex shrink-0 flex-col items-center">
        <div style={{ padding: `${QR_QUIET_ZONE}px` }}>
          <Image
            src="/qr-booking.svg"
            alt="Scan to book"
            width={220}
            height={220}
            className="size-55"
          />
        </div>
        <span className="text-[35px] leading-none font-semibold text-russian-violet">
          Scan to book
        </span>
      </div>
    </div>
  );
}

/**
 * Business card page for PDF export.
 * @param props - Page props.
 * @param props.searchParams - Next.js search params promise: `side` picks the
 *   face ("front" default, "back" for contact details), `mode=print` adds bleed.
 * @returns Business card page element.
 */
export default async function CardPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string; mode?: string }>;
}): Promise<React.ReactElement> {
  const { side, mode } = await searchParams;
  const { identity } = await getSettings();
  const isBack = side === "back";
  // 50px base inset (4.2mm safe margin) + 35px bleed (3 mm at 300 DPI) = 85px.
  const padding = mode === "print" ? "85px" : "50px";

  return (
    <div
      className="flex h-screen w-screen items-center justify-center overflow-hidden bg-white"
      style={{ padding }}
    >
      {isBack ? <CardBack identity={identity} /> : <CardFront identity={identity} />}
    </div>
  );
}
