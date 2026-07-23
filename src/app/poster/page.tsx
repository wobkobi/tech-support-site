// src/app/poster/page.tsx
/**
 * @description Poster page - A5 at 300 DPI (1748x2480px).
 * Pass ?mode=print to add a 3mm bleed on all edges (viewport 1818x2550px).
 */

import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import Image from "next/image";
import type React from "react";
import {
  FaCircleCheck,
  FaClock,
  FaCloud,
  FaEnvelope,
  FaGlobe,
  FaHouse,
  FaImages,
  FaLaptop,
  FaLocationDot,
  FaMobileScreen,
  FaPhone,
  FaPrint,
  FaRightLeft,
  FaShieldHalved,
  FaToolbox,
  FaTv,
  FaWifi,
} from "react-icons/fa6";

// Print artwork source, not a web page: keep it out of search results.
export const metadata: Metadata = {
  title: "Poster",
  robots: { index: false, follow: false },
};

const supportItems: Array<{ label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { label: "Computers", icon: FaLaptop },
  { label: "Phones & Tablets", icon: FaMobileScreen },
  { label: "Wi-Fi & Internet", icon: FaWifi },
  { label: "TV & Streaming", icon: FaTv },
  { label: "Smart Home", icon: FaHouse },
  { label: "Printers & Scanners", icon: FaPrint },
  { label: "Cloud & Backups", icon: FaCloud },
  { label: "Email & Accounts", icon: FaEnvelope },
  { label: "Safety & Security", icon: FaShieldHalved },
  { label: "Setup & Transfer", icon: FaRightLeft },
  { label: "Tune-ups & Repairs", icon: FaToolbox },
  { label: "Photos & Storage", icon: FaImages },
];

const aboutMeText =
  "Hi there, I'm Harrison. I'm a computer science graduate from Point Chevalier and I want to put my skills to good use helping the community. I grew up here and want to make technology more straightforward and less stressful for people who don't have a go-to tech person.";

const servicesText =
  "If you've got a tech issue, I've got you covered. I fix slow computers, set up new phones and laptops, sort Wi-Fi and network connections, connect printers and TVs, and ensure cloud backups and email run reliably. I can secure your devices, remove malware and scams, and safely move photos and files between devices. I'll explain everything in plain language, leave clear notes, and I won't try to upsell you. I'm local, flexible with evenings/weekends, and can help in person or remotely.";

/**
 * Poster page component for A5 export.
 * Accepts an optional `mode` search param - set to "print" for a 3mm bleed version.
 * @param root0 - Page props.
 * @param root0.searchParams - Next.js search params promise.
 * @returns Poster page element
 */
export default async function PosterPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}): Promise<React.ReactElement> {
  const { mode } = await searchParams;
  const { identity } = await getSettings();
  // 32px base + 35px bleed (3 mm at 300 DPI) = 67px
  const outerPadding = mode === "print" ? "67px" : "32px";

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      {/* Backdrop */}
      <div className="absolute inset-0 -z-10">
        <Image
          src="/source/backdrop.jpg"
          alt=""
          fill
          priority
          sizes="1748px"
          className="scale-110 object-cover blur-xl"
        />
      </div>

      {/* Even outer gap on all sides */}
      <div className="flex h-full w-full flex-col" style={{ padding: outerPadding }}>
        {/* Inner column fills available height so footer can pin to bottom */}
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-6">
          {/* Main frosted card - content-sized */}
          <div className="rounded-4xl border-[3px] border-seasalt-200/40 bg-white/60 p-6 shadow-xl backdrop-blur-xl">
            <div className="flex flex-col gap-6">
              {/* Logo (doubles as the document's top-level heading for a11y). */}
              <div className="grid place-items-center">
                <h1 className="sr-only">
                  To the Point Tech - Computer &amp; IT support in Auckland
                </h1>
                <Image
                  src="/source/logo-full.svg"
                  alt="To the Point Tech"
                  width={1376}
                  height={313}
                  priority
                  className="h-auto w-344"
                />
              </div>

              {/* Trust badges */}
              <div className="mx-auto flex flex-wrap justify-center gap-3">
                <div
                  className="relative flex items-center gap-3 rounded-xl border-2 border-moonstone-500/30 px-4.5 py-1.5 shadow-sm"
                  style={{ backgroundColor: "#f6f7f8" }}
                >
                  <div
                    className="absolute inset-0 rounded-xl"
                    style={{ backgroundColor: "rgba(67, 188, 205, 0.15)" }}
                  />
                  <FaCircleCheck className="relative z-10 h-11 w-11 text-moonstone-400" />
                  <span className="relative z-10 text-[34px] font-semibold text-rich-black">
                    CS Graduate
                  </span>
                </div>

                <div
                  className="relative flex items-center gap-3 rounded-xl border-2 border-moonstone-500/30 px-4.5 py-1.5 shadow-sm"
                  style={{ backgroundColor: "#f6f7f8" }}
                >
                  <div
                    className="absolute inset-0 rounded-xl"
                    style={{ backgroundColor: "rgba(67, 188, 205, 0.15)" }}
                  />
                  <FaLocationDot className="relative z-10 h-11 w-11 text-moonstone-400" />
                  <span className="relative z-10 text-[34px] font-semibold text-rich-black">
                    Proudly Local
                  </span>
                </div>

                <div
                  className="relative flex items-center gap-3 rounded-xl border-2 border-moonstone-500/30 px-4.5 py-1.5 shadow-sm"
                  style={{ backgroundColor: "#f6f7f8" }}
                >
                  <div
                    className="absolute inset-0 rounded-xl"
                    style={{ backgroundColor: "rgba(67, 188, 205, 0.15)" }}
                  />
                  <FaClock className="relative z-10 h-11 w-11 text-moonstone-400" />
                  <span className="relative z-10 text-[34px] font-semibold text-rich-black">
                    Same-Day Available
                  </span>
                </div>
              </div>

              {/* Text boxes - now content-sized with gap preserved */}
              <section className="flex flex-col gap-5">
                <div className="rounded-[18px] border-2 border-seasalt-200/60 bg-white p-4.5 shadow-sm">
                  <h2 className="mb-1.5 text-[53px] font-bold text-russian-violet">About Me</h2>
                  <p className="text-[40px] leading-tight font-medium text-rich-black">
                    {aboutMeText}
                  </p>
                </div>

                <div className="rounded-[18px] border-2 border-seasalt-200/60 bg-white p-4.5 shadow-sm">
                  <h2 className="mb-1.5 text-[53px] font-bold text-russian-violet">Services</h2>
                  <p className="text-[40px] leading-tight font-medium text-rich-black">
                    {servicesText}
                  </p>
                </div>
              </section>

              {/* Support grid */}
              <section>
                <h2 className="mb-3 text-center text-[53px] font-semibold text-rich-black">
                  Areas I Can Help With
                </h2>

                <ul className="grid grid-cols-3 gap-3">
                  {supportItems.map(({ label, icon: Icon }) => (
                    <li
                      key={label}
                      className="flex h-27 items-center gap-3 rounded-xl border-2 border-seasalt-200/60 bg-white px-4.5"
                    >
                      <span className="grid size-18 shrink-0 place-items-center rounded-xl border-2 border-moonstone-500/30 bg-moonstone-400/15">
                        <Icon className="h-11 w-11 text-moonstone-400" aria-hidden />
                      </span>

                      <span className="text-left text-[40px] leading-tight font-semibold text-rich-black">
                        {label}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>

          {/* Footer - content-sized */}
          <footer className="flex items-center justify-center">
            <div className="rounded-3xl border-2 border-seasalt-200/40 bg-white/70 p-10 shadow-xl backdrop-blur-md">
              <div className="flex items-center gap-11">
                {/* QR Code */}
                <div className="flex shrink-0 flex-col items-center gap-2">
                  <div className="grid size-60 place-items-center rounded-[10px] border-2 border-seasalt-200/60 bg-white p-3 shadow-sm">
                    <Image
                      src="/qr-booking.svg"
                      alt="Scan to book"
                      width={150}
                      height={150}
                      className="h-full w-full"
                    />
                  </div>
                  <span className="text-center text-[34px] font-semibold text-rich-black">
                    Scan to Book
                  </span>
                </div>

                {/* Contact Info */}
                <div className="flex flex-col gap-6">
                  <a
                    href={identity.phoneTel}
                    className="flex items-center gap-4 text-[44px] font-semibold text-russian-violet"
                  >
                    <FaPhone className="h-10 w-10 shrink-0" aria-hidden />
                    <span>{identity.phone}</span>
                  </a>

                  <a
                    href={`mailto:${identity.email}`}
                    className="flex items-center gap-4 text-[44px] font-semibold text-russian-violet"
                  >
                    <FaEnvelope className="h-11 w-11 shrink-0" aria-hidden />
                    <span>{identity.email}</span>
                  </a>

                  <div className="flex items-center gap-4 text-[44px] font-semibold">
                    <FaGlobe className="h-11 w-11 shrink-0 text-russian-violet" aria-hidden />
                    <p className="text-russian-violet">{identity.website}</p>
                  </div>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
