// src/app/intro/page.tsx
// Social intro artwork, 1080x1350 (4:5), for organic posts, so contact details sit on the
// image. ?variant=photo|v3|type (default); v3-wide is 1200x900 for Google Business Profile,
// which crops 4:5. CTAs stay typographic: button-shaped art trips Meta's ad review.

import { cn } from "@/shared/lib/cn";
import { SERVICE_AREAS } from "@/shared/lib/service-areas";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import Image from "next/image";
import fs from "node:fs";
import path from "node:path";
import React, { Fragment } from "react";
import { FaEnvelope, FaGlobe, FaPhone } from "react-icons/fa6";

// Artwork source, not a web page: keep it out of search results.
export const metadata: Metadata = {
  title: "Intro",
  robots: { index: false, follow: false },
};

/** Wordmark without the tagline, which is unreadable at feed size. */
const LOGO_SRC = "/source/logo-wordmark.svg";

/** Portrait used by the photo variant, relative to the public directory. */
const PHOTO_PUBLIC_PATH = "/source/harrison-2026.jpg";

/** Intro condensed from the poster's About Me; kept to three sentences for feed size. */
const introText =
  "I grew up in Point Chev. I fix what’s broken, explain what went wrong in plain English, and won’t sell you anything you don’t need.";

/** Proof line. Typographic rather than chips, so nothing reads as a button. */
const proofLine = "No jargon · Fair pricing · Weekends too";

/** Frosted card both layouts sit on, matching the booking confirmation page's panel. */
const CARD_CLASS =
  "flex min-h-0 flex-1 rounded-[44px] border-[3px] border-seasalt-200/50 bg-white/78 shadow-xl backdrop-blur-2xl";

/** Hairline rule between the text blocks. */
const RULE_CLASS = "h-px w-full bg-seasalt-200/80";

// Top six areas (SERVICE_AREAS is ordered by prominence); all twelve is a wall of text.
const serviceLabels = SERVICE_AREAS.slice(0, 6).map((area) => area.homeLabel);

/**
 * Report whether the portrait exists, so a missing file shows a placeholder. Aimed at
 * local capture; on Vercel public/ may not be readable, which just shows the placeholder.
 * @returns True when the portrait file is present and readable.
 */
function hasPortrait(): boolean {
  try {
    return fs.existsSync(path.join(process.cwd(), "public", PHOTO_PUBLIC_PATH));
  } catch {
    return false;
  }
}

/**
 * Round portrait, or a dashed placeholder naming the file to add when it is missing.
 * @param props - Component props.
 * @param props.ready - Whether the portrait file exists.
 * @param props.className - Size classes for the circle.
 * @returns Portrait element.
 */
function Portrait({ ready, className }: { ready: boolean; className: string }): React.ReactElement {
  if (ready) {
    return (
      <Image
        src={PHOTO_PUBLIC_PATH}
        alt="Harrison, To the Point Tech"
        width={420}
        height={420}
        preload
        className={cn("rounded-full border-[6px] border-white object-cover shadow-lg", className)}
      />
    );
  }
  return (
    <div
      className={cn(
        "grid place-items-center rounded-full border-[6px] border-dashed border-russian-violet/30 bg-white/70 p-8 text-center",
        className,
      )}
    >
      <p className="text-[26px] leading-tight font-semibold text-russian-violet/70">
        Add a portrait at
        <br />
        public{PHOTO_PUBLIC_PATH}
      </p>
    </div>
  );
}

/**
 * The six lead service areas as one line of text with dot separators.
 * @param props - Component props.
 * @param props.className - Alignment, width and size overrides.
 * @returns Service list element.
 */
function ServiceList({ className }: { className: string }): React.ReactElement {
  return (
    <p
      className={cn(
        "text-[32px] leading-snug font-semibold text-balance text-moonstone-600",
        className,
      )}
    >
      {serviceLabels.map((label, i) => (
        <Fragment key={label}>
          {/* Nowrap labels so breaks land only on separators ("Wi-Fi" breaks at its hyphen). */}
          {i > 0 && " · "}
          <span className="whitespace-nowrap">{label}</span>
        </Fragment>
      ))}
    </p>
  );
}

/**
 * Phone, email, website stacked in the poster's order; inline would overrun the card.
 * @param props - Component props.
 * @param props.phone - Business phone number.
 * @param props.email - Business email address.
 * @param props.website - Business website, without the scheme.
 * @param props.textClass - Text size for each line.
 * @param props.iconClass - Icon size for each line.
 * @returns Contact block element.
 */
function ContactList({
  phone,
  email,
  website,
  textClass,
  iconClass,
}: {
  phone: string;
  email: string;
  website: string;
  textClass: string;
  iconClass: string;
}): React.ReactElement {
  const lines = [
    { Icon: FaPhone, text: phone },
    { Icon: FaEnvelope, text: email },
    { Icon: FaGlobe, text: website },
  ];
  return (
    <div className="flex flex-col items-start gap-3">
      {lines.map(({ Icon, text }) => (
        <span
          key={text}
          className={cn("flex items-center gap-4 font-bold text-russian-violet", textClass)}
        >
          <Icon className={cn("shrink-0", iconClass)} aria-hidden />
          {text}
        </span>
      ))}
    </div>
  );
}

/**
 * Social intro artwork for organic Facebook/Instagram/Google posts.
 * @param root0 - Page props.
 * @param root0.searchParams - Next.js search params promise.
 * @returns Intro artwork element.
 */
export default async function IntroPage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}): Promise<React.ReactElement> {
  const { variant } = await searchParams;
  const { identity } = await getSettings();
  // v3: photo layout with the service list in place of the name headline and intro.
  const isWide = variant === "v3-wide";
  const isV3 = variant === "v3" || isWide;
  const showPhoto = variant === "photo" || isV3;
  const portraitReady = showPhoto && hasPortrait();
  const contact = { phone: identity.phone, email: identity.email, website: identity.website };

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Site backdrop; the scrim tames the sunburst showing through the card. */}
      <div className="absolute inset-0 -z-10">
        <Image
          src="/source/backdrop.jpg"
          alt=""
          fill
          preload
          sizes="1200px"
          className="scale-110 object-cover blur-xl"
        />
        <div className="absolute inset-0 bg-seasalt-100/45" />
      </div>

      <div className="flex h-full w-full flex-col p-10">
        {isWide ? (
          // 4:3: portrait left, everything else stacked and left-aligned on the right.
          <div className={cn(CARD_CLASS, "items-center gap-14 px-14 py-10")}>
            <Portrait ready={portraitReady} className="size-96 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col items-start gap-5">
              <Image
                src={LOGO_SRC}
                alt="To the Point Tech"
                width={2000}
                height={674}
                preload
                className="h-auto w-80"
              />
              <h1 className="text-[52px] leading-tight font-extrabold tracking-tight text-balance text-russian-violet">
                Computer &amp; IT help across Auckland
              </h1>
              <div className={RULE_CLASS} />
              <ServiceList className="text-left text-[26px]" />
              <div className={RULE_CLASS} />
              <p className="text-[24px] font-semibold text-russian-violet/75">{proofLine}</p>
              <ContactList {...contact} textClass="text-[30px]" iconClass="h-7 w-7" />
            </div>
          </div>
        ) : (
          // Centred as one mass. The portrait costs ~400px, so the photo variant
          // drops the service list and tightens gaps to fit 1350px.
          <div
            className={cn(
              CARD_CLASS,
              "flex-col items-center justify-center px-12",
              showPhoto ? "gap-6 py-10" : "gap-14 py-14",
            )}
          >
            {/* Top block: portrait plus wordmark, or the wordmark alone. */}
            <div className="flex flex-col items-center gap-5">
              {showPhoto ? (
                <>
                  <Portrait ready={portraitReady} className={isV3 ? "size-88" : "size-84"} />
                  <Image
                    src={LOGO_SRC}
                    alt="To the Point Tech"
                    width={2000}
                    height={674}
                    preload
                    className="h-auto w-110"
                  />
                </>
              ) : (
                <Image
                  src={LOGO_SRC}
                  alt="To the Point Tech"
                  width={2000}
                  height={674}
                  preload
                  className="h-auto w-160"
                />
              )}
            </div>

            {/* Introduction */}
            <div className="flex flex-col items-center gap-4 text-center">
              {isV3 ? (
                // No name headline, so this line takes the headline's weight.
                <h1 className="text-[64px] leading-tight font-extrabold tracking-tight text-balance text-russian-violet">
                  Computer &amp; IT help across Auckland
                </h1>
              ) : (
                <>
                  <h1 className="text-[88px] leading-none font-extrabold tracking-tight text-russian-violet">
                    Hi, I’m Harrison
                  </h1>
                  <p className="text-[44px] leading-tight font-bold text-rich-black">
                    Computer &amp; IT help across Auckland
                  </p>
                </>
              )}
              {!isV3 && (
                <p className="max-w-207.5 text-[33px] leading-snug font-medium text-balance text-rich-black/85">
                  {introText}
                </p>
              )}
            </div>

            {/* Coverage, proof and contact as one bottom block, plain text only. */}
            <div className="flex w-full flex-col items-center gap-6">
              <div className={RULE_CLASS} />

              {/* Photo variant spends this height on the portrait; v3 has room for the list. */}
              {(!showPhoto || isV3) && (
                <>
                  <ServiceList className="max-w-205 text-center" />
                  <div className={RULE_CLASS} />
                </>
              )}

              <p className="text-[29px] font-semibold text-russian-violet/75">{proofLine}</p>

              <ContactList {...contact} textClass="text-[38px]" iconClass="h-8 w-8" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
