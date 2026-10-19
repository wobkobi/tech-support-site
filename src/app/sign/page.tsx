// src/app/sign/page.tsx
// Yard sign artwork, 600x900mm corflute at 3px/mm (1800x2700px); 2x capture gives ~152 DPI.
// ?mode=print adds 3mm bleed (1818x2718px). Styled like the home hero, sized to read from a
// passing car, so the phone number is the largest thing after the logo.

import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import Image from "next/image";
import type React from "react";
import {
  FaLaptop,
  FaMobileScreen,
  FaPhone,
  FaPrint,
  FaShieldHalved,
  FaTv,
  FaWifi,
} from "react-icons/fa6";

// Print artwork source, not a web page: keep it out of search results.
export const metadata: Metadata = {
  title: "Yard sign",
  robots: { index: false, follow: false },
};

/** One service card: moonstone icon badge plus a label of at most two short lines. */
interface SignService {
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

/** Six of the home page's twelve items; twelve would be unreadable from the road. */
const SERVICES: SignService[] = [
  { label: "Computers & Laptops", icon: FaLaptop },
  { label: "Phones & Tablets", icon: FaMobileScreen },
  { label: "Wi-Fi & Networks", icon: FaWifi },
  { label: "Smart TVs", icon: FaTv },
  { label: "Printers", icon: FaPrint },
  { label: "Security", icon: FaShieldHalved },
];

/** The home hero's availability line, trimmed to two items so each stays large. */
const AVAILABILITY = ["Same day appointments", "Weekends too"] as const;

/**
 * Yard sign page for PDF export.
 * @param props - Page props.
 * @param props.searchParams - Next.js search params promise: `mode=print` adds bleed.
 * @returns Yard sign page element.
 */
export default async function SignPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}): Promise<React.ReactElement> {
  const { mode } = await searchParams;
  const { identity } = await getSettings();
  // 25mm safe inset (75px) clears H-stake holes and clips; print adds 9px (3mm) bleed.
  const padding = mode === "print" ? "84px" : "75px";

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Backdrop - same photo and blur treatment as the site and the poster */}
      <div className="absolute inset-0 -z-10">
        <Image
          src="/source/backdrop.jpg"
          alt=""
          fill
          preload
          sizes="1800px"
          className="scale-110 object-cover blur-xl"
        />
      </div>

      <div className="flex h-full w-full flex-col" style={{ padding }}>
        {/* Frosted panel - the site's FrostedSection at sign scale */}
        <div className="flex flex-1 flex-col items-center justify-between rounded-[64px] border-[3px] border-seasalt-200/40 bg-white/60 px-18 py-18 text-center shadow-xl backdrop-blur-xl">
          {/* Logo doubles as the document's top-level heading for a11y. */}
          <h1 className="sr-only">{identity.company} - Computer &amp; IT Support in Auckland</h1>
          <Image
            src="/source/logo-full.svg"
            alt={identity.company}
            width={2000}
            height={674}
            preload
            className="h-auto w-310"
          />

          <p className="text-[128px] leading-[1.05] font-extrabold text-russian-violet">
            Computer &amp; IT Support
            <br />
            in Auckland
          </p>

          {/* Services - the home page's white cards with moonstone badges */}
          <ul className="grid w-full grid-cols-3 gap-8">
            {SERVICES.map(({ label, icon: Icon }) => (
              <li
                key={label}
                className="flex flex-col items-center gap-6 rounded-4xl border-2 border-seasalt-200/80 bg-white px-6 py-10 shadow-sm"
              >
                <span className="grid size-44 place-items-center rounded-full border-4 border-moonstone-500/50 bg-moonstone-400/30">
                  <Icon className="size-24 text-moonstone-400" aria-hidden />
                </span>
                <span className="flex min-h-[2.1em] items-center text-[62px] leading-[1.05] font-bold text-rich-black">
                  {label}
                </span>
              </li>
            ))}
          </ul>

          {/* Phone - the site's navy secondary button */}
          <div className="flex w-full items-center justify-center gap-14 rounded-[44px] bg-russian-violet px-12 py-12 text-seasalt shadow-lg">
            <FaPhone className="size-36 shrink-0" aria-hidden />
            <span className="text-[210px] leading-none font-extrabold tracking-tight tabular-nums">
              {identity.phone}
            </span>
          </div>

          {/* Website and availability */}
          <div className="flex flex-col items-center gap-7">
            <p className="text-[128px] leading-none font-extrabold text-coquelicot-600">
              {identity.website}
            </p>
            <p className="text-[60px] leading-none font-semibold text-rich-black/80">
              {AVAILABILITY[0]}
              <span className="mx-7 text-coquelicot-600">&bull;</span>
              {AVAILABILITY[1]}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
