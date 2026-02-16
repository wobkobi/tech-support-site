// src/app/poster/page.tsx
/**
 * POSTER PAGE - A4 at 300 DPI (1680x2308px)
 * Even outer gap on all 4 sides:
 * - Controlled by p-[60px] on the main content wrapper.
 * Footer sits on the bottom edge of the padded area via mt-auto.
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
  "Hi there, I'm Harrison. I'm a computer science graduate from Point Chevalier, eager to apply my practical tech skills to benefit the community. I grew up here and want to make technology more straightforward and less stressful for people who don't have a go-to tech person.";

const servicesText =
  "If you've got a tech issue, I've got you covered. I fix slow computers, set up new phones and laptops, sort Wi-Fi and network connections, connect printers and TVs, and ensure cloud backups and email run reliably. I can secure your devices, remove malware and scams, and safely move photos and files between devices. I will explain everything in plain language, leave clear notes, and not upsell. I'm local, flexible with evenings/weekends, and can help in person or remotely.";

/**
 * Poster page component for A4 print export
 * @returns React element containing the poster layout
 */
export default function PosterPage(): React.ReactElement {
  return (
    <div className={cn("relative h-577 w-420 overflow-hidden")}>
      {/* Backdrop */}
      <div className={cn("absolute inset-0 -z-10")}>
        <Image
          src="/backdrop.jpg"
          alt=""
          fill
          priority
          sizes="1680px"
          className={cn("scale-110 object-cover blur-xl")}
        />
      </div>

      {/* Even outer gap on all sides */}
      <div className={cn("flex h-full w-full flex-col p-10")}>
        {/* Inner column fills available height so footer can pin to bottom */}
        <div className={cn("flex min-h-0 flex-1 flex-col")}>
          {/* Main frosted card */}
          <div
            className={cn(
              "rounded-4xl border-seasalt-400/40 bg-seasalt-800/60 border-[3px] p-7.5 shadow-xl backdrop-blur-xl",
            )}
          >
            {/* Logo */}
            <div className={cn("grid place-items-center pb-5")}>
              <Image
                src="/logo-full.svg"
                alt="To The Point Tech"
                width={1376}
                height={313}
                priority
                className={cn("h-auto w-344")}
              />
            </div>

            {/* Trust badges */}
            <div className={cn("mx-auto mb-5 flex flex-wrap justify-center gap-3")}>
              <div
                className={cn(
                  "relative flex items-center gap-3 rounded-xl border-2 border-moonstone-500/30 px-4.5 py-1.5 shadow-sm",
                )}
                style={{ backgroundColor: '#f6f7f8' }}
              >
                <div 
                  className={cn("absolute inset-0 rounded-xl")} 
                  style={{ backgroundColor: 'rgba(67, 188, 205, 0.15)' }}
                />
                <FaCircleCheck className={cn("relative z-10 text-moonstone-600 h-9 w-9")} />
                <span className={cn("relative z-10 text-rich-black text-[34px] font-semibold")}>CS Graduate</span>
              </div>

              <div
                className={cn(
                  "relative flex items-center gap-3 rounded-xl border-2 border-moonstone-500/30 px-4.5 py-1.5 shadow-sm",
                )}
                style={{ backgroundColor: '#f6f7f8' }}
              >
                <div 
                  className={cn("absolute inset-0 rounded-xl")} 
                  style={{ backgroundColor: 'rgba(67, 188, 205, 0.15)' }}
                />
                <FaLocationDot className={cn("relative z-10 text-moonstone-600 h-9 w-9")} />
                <span className={cn("relative z-10 text-rich-black text-[34px] font-semibold")}>
                  Pt Chev Local
                </span>
              </div>

              <div
                className={cn(
                  "relative flex items-center gap-3 rounded-xl border-2 border-moonstone-500/30 px-4.5 py-1.5 shadow-sm",
                )}
                style={{ backgroundColor: '#f6f7f8' }}
              >
                <div 
                  className={cn("absolute inset-0 rounded-xl")} 
                  style={{ backgroundColor: 'rgba(67, 188, 205, 0.15)' }}
                />
                <FaClock className={cn("relative z-10 text-moonstone-600 h-9 w-9")} />
                <span className={cn("relative z-10 text-rich-black text-[34px] font-semibold")}>
                  Same-Day Available
                </span>
              </div>
            </div>

            {/* Text boxes */}
            <section className={cn("flex flex-col gap-5")}>
              <div
                className={cn(
                  "border-seasalt-400/60 bg-seasalt-800 rounded-[18px] border-2 p-4.5 shadow-sm",
                )}
              >
                <h2 className={cn("text-russian-violet mb-1.5 text-[53px] font-bold")}>
                  About Me
                </h2>
                <p className={cn("text-rich-black text-[38px] font-medium leading-tight")}>
                  {aboutMeText}
                </p>
              </div>

              <div
                className={cn(
                  "border-seasalt-400/60 bg-seasalt-800 rounded-[18px] border-2 p-4.5 shadow-sm",
                )}
              >
                <h2 className={cn("text-russian-violet mb-1.5 text-[53px] font-bold")}>
                  Services
                </h2>
                <p className={cn("text-rich-black text-[38px] font-medium leading-tight")}>
                  {servicesText}
                </p>
              </div>
            </section>

            {/* Support grid */}
            <section className={cn("mt-3")}>
              <h2 className={cn("text-rich-black mb-3 text-center text-[53px] font-semibold")}>
                Areas I Can Help With
              </h2>

              <ul className={cn("grid grid-cols-3 gap-3")}>
                {supportItems.map(({ label, icon: Icon }) => (
                  <li
                    key={label}
                    className={cn(
                      "border-seasalt-400/60 bg-seasalt-800 flex h-27 items-center gap-3 rounded-xl border-2 px-4.5",
                    )}
                  >
                    <span
                      className={cn(
                        "border-moonstone-500/30 bg-moonstone-600/15 grid size-15 shrink-0 place-items-center rounded-xl border-2",
                      )}
                    >
                      <Icon className={cn("text-moonstone-600 h-9 w-9")} aria-hidden />
                    </span>

                    <span
                      className={cn(
                        "text-rich-black text-left text-[34px] font-semibold leading-tight",
                      )}
                    >
                      {label}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* Fixed gap between main card and footer */}
          <div className={cn("h-10")} />

          {/* Footer pinned to the bottom of the padded area */}
          <footer className={cn("mx-auto mt-auto w-fit")}>
            <div
              className={cn(
                "bg-seasalt-800/70 rounded-[14px] border-seasalt-400/40 border-2 p-4.5 shadow-xl backdrop-blur-md",
              )}
            >
              <div className={cn("flex items-center gap-7")}>
                {/* QR Code */}
                <div className={cn("flex shrink-0 flex-col items-center gap-1")}>
                  <div
                    className={cn(
                      "border-seasalt-400/60 grid size-37.5 place-items-center rounded-[10px] border-2 bg-white p-2.5 shadow-sm",
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
                  <span className={cn("text-rich-black text-center text-[24px] font-semibold")}>
                    Scan to Book
                  </span>
                </div>

                {/* Contact Info */}
                <div className={cn("flex flex-col gap-2.5")}>
                  <a
                    href="tel:+64212971237"
                    className={cn(
                      "text-russian-violet flex items-center gap-3.5 text-[34px] font-semibold",
                    )}
                  >
                    <FaPhone className={cn("h-7.5 w-7.5 shrink-0")} aria-hidden />
                    <span>021 297 1237</span>
                  </a>

                  <a
                    href="mailto:harrison@tothepoint.co.nz"
                    className={cn(
                      "text-russian-violet flex items-center gap-3.5 text-[34px] font-semibold",
                    )}
                  >
                    <FaEnvelope className={cn("h-7.5 w-7.5 shrink-0")} aria-hidden />
                    <span>harrison@tothepoint.co.nz</span>
                  </a>

                  <div className={cn("flex items-center gap-3.5 text-[34px] font-semibold")}>
                    <FaGlobe
                      className={cn("text-russian-violet h-7.5 w-7.5 shrink-0")}
                      aria-hidden
                    />
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