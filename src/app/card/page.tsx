// src/app/card/page.tsx
// Business card artwork, 90x55mm at 300 DPI (1063x650px). ?side=back for the contact face,
// ?mode=print adds 3mm bleed (1134x721px). Plain white: the backdrop reads as mud at 90mm,
// and no extra rules, which would read as a stray piece of the logo.

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

/** QR edge in px at 300 DPI: 260px prints at 22mm (over the 2cm floor), ~0.76mm per module. */
const QR_SIZE = 260;

/**
 * Four-module quiet zone above and below the QR; the SVG has almost no margin.
 * Sideways the row gap and safe margin already cover it.
 */
const QR_QUIET_ZONE = 36;

/**
 * One contact line, sized to stay readable for older customers.
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
        preload
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
 * Contact face: phone, email, website, service area and a booking QR.
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
        <div style={{ paddingBlock: `${QR_QUIET_ZONE}px` }}>
          <Image
            src="/qr-booking.svg"
            alt="Scan to book"
            width={QR_SIZE}
            height={QR_SIZE}
            style={{ width: QR_SIZE, height: QR_SIZE }}
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
 * @param props.searchParams - `side` ("front" or "back") and `mode=print` for bleed.
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
