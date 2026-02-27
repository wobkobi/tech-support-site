// src/app/poster/page.tsx
/**
 * @file page.tsx
 * @description Poster page - A5 at 300 DPI (1748x2480px) with even outer padding.
 */

import { cn } from "@/lib/cn";
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
 * Poster page component for A5 print export
 * @returns Poster page element
 */
export default function PosterPage(): React.ReactElement {
  return (
    <div className={cn("relative h-screen w-screen overflow-hidden")}>
      {/* Backdrop */}
      <div className={cn("absolute inset-0 -z-10")}>
        <Image
          src="/source/backdrop.jpg"
          alt=""
          fill
          priority
          sizes="1748px"
          className={cn("scale-110 object-cover blur-xl")}
        />
      </div>

      {/* Even outer gap on all sides */}
      <div className={cn("flex h-full w-full flex-col p-8")}>
        {/* Inner column fills available height so footer can pin to bottom */}
        <div className={cn("flex min-h-0 flex-1 flex-col justify-between gap-8")}>
          {/* Main frosted card - content-sized */}
          <div
            className={cn(
              "rounded-4xl border-seasalt-400/40 bg-seasalt-800/60 border-[3px] p-6 shadow-xl backdrop-blur-xl",
            )}
          >
            <div className={cn("flex flex-col gap-8")}>
              {/* Logo */}
              <div className={cn("grid place-items-center")}>
                <Image
                  src="/source/logo-full.svg"
                  alt="To The Point Tech"
                  width={1376}
                  height={313}
                  priority
                  className={cn("w-344 h-auto")}
                />
              </div>

              {/* Trust badges */}
              <div className={cn("mx-auto flex flex-wrap justify-center gap-3")}>
                <div
                  className={cn(
                    "border-moonstone-500/30 px-4.5 relative flex items-center gap-3 rounded-xl border-2 py-1.5 shadow-sm",
                  )}
                  style={{ backgroundColor: "#f6f7f8" }}
                >
                  <div
                    className={cn("absolute inset-0 rounded-xl")}
                    style={{ backgroundColor: "rgba(67, 188, 205, 0.15)" }}
                  />
                  <FaCircleCheck className={cn("text-moonstone-600 relative z-10 h-11 w-11")} />
                  <span className={cn("text-rich-black relative z-10 text-[34px] font-semibold")}>
                    CS Graduate
                  </span>
                </div>

                <div
                  className={cn(
                    "border-moonstone-500/30 px-4.5 relative flex items-center gap-3 rounded-xl border-2 py-1.5 shadow-sm",
                  )}
                  style={{ backgroundColor: "#f6f7f8" }}
                >
                  <div
                    className={cn("absolute inset-0 rounded-xl")}
                    style={{ backgroundColor: "rgba(67, 188, 205, 0.15)" }}
                  />
                  <FaLocationDot className={cn("text-moonstone-600 relative z-10 h-11 w-11")} />
                  <span className={cn("text-rich-black relative z-10 text-[34px] font-semibold")}>
                    Proudly Local
                  </span>
                </div>

                <div
                  className={cn(
                    "border-moonstone-500/30 px-4.5 relative flex items-center gap-3 rounded-xl border-2 py-1.5 shadow-sm",
                  )}
                  style={{ backgroundColor: "#f6f7f8" }}
                >
                  <div
                    className={cn("absolute inset-0 rounded-xl")}
                    style={{ backgroundColor: "rgba(67, 188, 205, 0.15)" }}
                  />
                  <FaClock className={cn("text-moonstone-600 relative z-10 h-11 w-11")} />
                  <span className={cn("text-rich-black relative z-10 text-[34px] font-semibold")}>
                    Same Day Available
                  </span>
                </div>
              </div>

              {/* Text boxes - now content-sized with gap preserved */}
              <section className={cn("flex flex-col gap-5")}>
                <div
                  className={cn(
                    "border-seasalt-400/60 bg-seasalt-800 p-4.5 rounded-[18px] border-2 shadow-sm",
                  )}
                >
                  <h2 className={cn("text-russian-violet mb-1.5 text-[53px] font-bold")}>
                    About Me
                  </h2>
                  <p className={cn("text-rich-black text-[40px] font-medium leading-tight")}>
                    {aboutMeText}
                  </p>
                </div>

                <div
                  className={cn(
                    "border-seasalt-400/60 bg-seasalt-800 p-4.5 rounded-[18px] border-2 shadow-sm",
                  )}
                >
                  <h2 className={cn("text-russian-violet mb-1.5 text-[53px] font-bold")}>
                    Services
                  </h2>
                  <p className={cn("text-rich-black text-[40px] font-medium leading-tight")}>
                    {servicesText}
                  </p>
                </div>
              </section>

              {/* Support grid */}
              <section>
                <h2 className={cn("text-rich-black mb-3 text-center text-[53px] font-semibold")}>
                  Areas I Can Help With
                </h2>

                <ul className={cn("grid grid-cols-3 gap-3")}>
                  {supportItems.map(({ label, icon: Icon }) => (
                    <li
                      key={label}
                      className={cn(
                        "border-seasalt-400/60 bg-seasalt-800 h-27 px-4.5 flex items-center gap-3 rounded-xl border-2",
                      )}
                    >
                      <span
                        className={cn(
                          "border-moonstone-500/30 bg-moonstone-600/15 size-18 grid shrink-0 place-items-center rounded-xl border-2",
                        )}
                      >
                        <Icon className={cn("text-moonstone-600 h-11 w-11")} aria-hidden />
                      </span>

                      <span
                        className={cn(
                          "text-rich-black text-left text-[40px] font-semibold leading-tight",
                        )}
                      >
                        {label}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>

          {/* Footer - content-sized */}
          <footer className={cn("flex items-center justify-center")}>
            <div
              className={cn(
                "bg-seasalt-800/70 border-seasalt-400/40 rounded-3xl border-2 p-10 shadow-xl backdrop-blur-md",
              )}
            >
              <div className={cn("flex items-center gap-11")}>
                {/* QR Code */}
                <div className={cn("flex shrink-0 flex-col items-center gap-2")}>
                  <div
                    className={cn(
                      "border-seasalt-400/60 grid size-60 place-items-center rounded-[10px] border-2 bg-white p-3 shadow-sm",
                    )}
                  >
                    <Image
                      src="/qr-booking.svg"
                      alt="Scan to book"
                      width={150}
                      height={150}
                      className={cn("h-full w-full")}
                    />
                  </div>
                  <span className={cn("text-rich-black text-center text-[34px] font-semibold")}>
                    Scan to Book
                  </span>
                </div>

                {/* Contact Info */}
                <div className={cn("flex flex-col gap-6")}>
                  <a
                    href="tel:+64212971237"
                    className={cn(
                      "text-russian-violet flex items-center gap-4 text-[44px] font-semibold",
                    )}
                  >
                    <FaPhone className={cn("h-11 w-11 shrink-0")} aria-hidden />
                    <span>021 297 1237</span>
                  </a>

                  <a
                    href="mailto:harrison@tothepoint.co.nz"
                    className={cn(
                      "text-russian-violet flex items-center gap-4 text-[44px] font-semibold",
                    )}
                  >
                    <FaEnvelope className={cn("h-11 w-11 shrink-0")} aria-hidden />
                    <span>harrison@tothepoint.co.nz</span>
                  </a>

                  <div className={cn("flex items-center gap-4 text-[44px] font-semibold")}>
                    <FaGlobe className={cn("text-russian-violet h-11 w-11 shrink-0")} aria-hidden />
                    <p className={cn("text-russian-violet")}>tothepoint.co.nz</p>
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
