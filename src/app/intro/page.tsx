// src/app/intro/page.tsx
// Social intro artwork - 1080x1350 (4:5), Meta's recommended feed ratio, captured at 2x
// by scripts/export-social-screenshot.ts. Built for ORGANIC posts (community groups),
// which is why it carries contact details on the image: unlike a paid placement there is
// no Meta CTA button beneath it, so the image is the only thing a reader can act on.
// Pass ?variant=photo for the portrait version, ?variant=v3 for the portrait without the
// name headline, ?variant=type (default) for logo-only.
// Every call to action stays typographic - a flat image has nothing clickable, and
// button-shaped artwork misleads readers and trips Meta's ad review.

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

/**
 * Wordmark without the tagline. At feed size the tagline is too small to read,
 * and the headline beneath already says what the business does.
 */
const LOGO_SRC = "/source/logo-wordmark.svg";

/** Portrait used by the photo variant, relative to the public directory. */
const PHOTO_PUBLIC_PATH = "/source/harrison.jpg";

/**
 * First-person intro, condensed from the poster's About Me so the two pieces of
 * artwork speak with one voice. Three short sentences: at feed size anything
 * longer stops being read.
 */
const introText =
  "I grew up in Point Chev. I fix what’s broken, explain what went wrong in plain English, and won’t sell you anything you don’t need.";

/** Proof line. Typographic rather than chips, so nothing reads as a button. */
const proofLine = "No jargon · Fair pricing · Evenings & weekends";

// Lead with the six most recognisable areas rather than all twelve: the full set
// turns into a wall of small text at feed size. SERVICE_AREAS is ordered by
// prominence already, so the slice tracks any reordering there.
// Each label renders inside its own nowrap span so breaks land on the separators.
// A non-breaking space is not enough: "Wi-Fi" also offers a break at its hyphen,
// which strands a "Wi-" at the end of a line.
const serviceLabels = SERVICE_AREAS.slice(0, 6).map((area) => area.homeLabel);

/**
 * Report whether the portrait has been added to the public directory.
 *
 * Reads the filesystem rather than trusting the URL so a missing file renders a
 * visible placeholder instead of a broken image. Aimed at local capture: on
 * Vercel the public directory is served by the CDN and is not guaranteed to be
 * readable from the function filesystem, so a false here just means the
 * placeholder shows.
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
 * Social intro artwork for organic Facebook/Instagram posts.
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
  // v3 is the photo layout cut down to what the business does: no name headline
  // and no intro paragraph, with the service list back in their place.
  const isV3 = variant === "v3";
  const showPhoto = variant === "photo" || isV3;
  const portraitReady = showPhoto && hasPortrait();

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Backdrop - the same blurred image the site sits on. The scrim tames the
          sunburst in the middle of the photo, which otherwise reads straight
          through the frosted card and competes with the headline. */}
      <div className="absolute inset-0 -z-10">
        <Image
          src="/source/backdrop.jpg"
          alt=""
          fill
          priority
          sizes="1080px"
          className="scale-110 object-cover blur-xl"
        />
        <div className="absolute inset-0 bg-seasalt-100/45" />
      </div>

      <div className="flex h-full w-full flex-col p-10">
        {/* Centre the content as one mass with even gaps. Spreading the blocks to
            the card edges leaves a void in the middle at this aspect ratio.
            The portrait costs roughly 400px that the wordmark alone does not, so
            the photo variant drops the service list and runs tighter gaps to
            stay inside 1350px. */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col items-center justify-center rounded-[44px] border-[3px] border-seasalt-200/50 bg-white/78 px-12 shadow-xl backdrop-blur-2xl",
            showPhoto ? "gap-6 py-10" : "gap-14 py-14",
          )}
        >
          {/* Top block: the portrait carries the introduction when there is one,
              otherwise the wordmark does. Both keep the brand mark on the image. */}
          <div className="flex flex-col items-center gap-5">
            {showPhoto ? (
              <>
                {portraitReady ? (
                  <Image
                    src={PHOTO_PUBLIC_PATH}
                    alt="Harrison, To the Point Tech"
                    width={420}
                    height={420}
                    priority
                    className={cn(
                      "rounded-full border-[6px] border-white object-cover shadow-lg",
                      isV3 ? "size-88" : "size-84",
                    )}
                  />
                ) : (
                  <div
                    className={cn(
                      "grid place-items-center rounded-full border-[6px] border-dashed border-russian-violet/30 bg-white/70 p-8 text-center",
                      isV3 ? "size-88" : "size-84",
                    )}
                  >
                    <p className="text-[26px] leading-tight font-semibold text-russian-violet/70">
                      Add a portrait at
                      <br />
                      public{PHOTO_PUBLIC_PATH}
                    </p>
                  </div>
                )}
                <Image
                  src={LOGO_SRC}
                  alt="To the Point Tech"
                  width={2000}
                  height={674}
                  priority
                  className="h-auto w-110"
                />
              </>
            ) : (
              <Image
                src={LOGO_SRC}
                alt="To the Point Tech"
                width={2000}
                height={674}
                priority
                className="h-auto w-160"
              />
            )}
          </div>

          {/* Introduction */}
          <div className="flex flex-col items-center gap-4 text-center">
            {isV3 ? (
              // With no name headline, this line is the first thing read, so it
              // takes the headline's weight rather than sitting as a subtitle.
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

          {/* Coverage, proof and contact travel together as one bottom block:
              spreading them apart leaves voids at this aspect ratio. Everything
              here is plain text between rules - the image is flat, so anything
              shaped like a control would be a dead target. */}
          <div className="flex w-full flex-col items-center gap-6">
            <div className="h-px w-full bg-seasalt-200/80" />

            {/* The photo variant spends this block's height on a larger portrait:
                a face does more for an intro than a service list, and the
                headline already says what the business does. v3 has the room
                back from dropping the intro paragraph, so it keeps the list. */}
            {(!showPhoto || isV3) && (
              <>
                <p className="max-w-205 text-center text-[32px] leading-snug font-semibold text-balance text-moonstone-600">
                  {serviceLabels.map((label, i) => (
                    <Fragment key={label}>
                      {/* Separator sits outside the span: its surrounding spaces are
                          the only break opportunities the line gets. */}
                      {i > 0 && " · "}
                      <span className="whitespace-nowrap">{label}</span>
                    </Fragment>
                  ))}
                </p>

                <div className="h-px w-full bg-seasalt-200/80" />
              </>
            )}

            <p className="text-[29px] font-semibold text-russian-violet/75">{proofLine}</p>

            {/* Phone, email then website, stacked in the poster's order and with
                its icons, so the two pieces of artwork present contact the same
                way. Stacked rather than inline: all three side by side overrun
                1080px at this weight. */}
            <div className="flex flex-col items-start gap-3">
              <span className="flex items-center gap-4 text-[38px] font-bold text-russian-violet">
                <FaPhone className="h-8 w-8 shrink-0" aria-hidden />
                {identity.phone}
              </span>
              <span className="flex items-center gap-4 text-[38px] font-bold text-russian-violet">
                <FaEnvelope className="h-8 w-8 shrink-0" aria-hidden />
                {identity.email}
              </span>
              <span className="flex items-center gap-4 text-[38px] font-bold text-russian-violet">
                <FaGlobe className="h-8 w-8 shrink-0" aria-hidden />
                {identity.website}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
