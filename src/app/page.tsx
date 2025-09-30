// src/app/page.tsx
/**
 * Mobile-first landing with:
 * - Frosted logo panel (content-sized)
 * - Stacked info cards that sit OUTSIDE the frosted panel
 * - Support grid that auto-fits (1→3→5 cols) and matches the info width
 * - Cards sized to tidy rectangles, not wild aspect ratios
 */

import { cn } from "@/lib/cn";
import Image from "next/image";
import {
  FaCloud,
  FaEnvelope,
  FaHouse,
  FaImages,
  FaLaptop,
  FaMobileScreen,
  FaPhone,
  FaPrint,
  FaRightLeft,
  FaShieldHalved,
  FaToolbox,
  FaTv,
  FaWifi,
} from "react-icons/fa6";

const supportItems = [
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

/**
 * Home page component
 * @returns The Home page React element.
 */
export default function Home(): React.ReactElement {
  return (
    <main className={cn("relative min-h-dvh overflow-hidden")}>
      {/* Backdrop*/}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 -z-10 overflow-hidden select-none"
        )}>
        <Image
          src="/backdrop.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className={cn(
            "scale-110 transform-gpu object-cover blur-xl select-none"
          )}
        />
      </div>

      {/* Frosted container  */}
      <div
        className={cn(
          "mx-auto my-4 w-full max-w-[min(100vw-2rem,68rem)] sm:my-8"
        )}>
        <div
          className={cn(
            "border-seasalt-400/40 bg-seasalt-800/60 rounded-2xl border p-4 shadow-lg backdrop-blur-xl sm:p-8"
          )}>
          {/* Logo */}
          <div className={cn("grid place-items-center pb-4 sm:pb-6")}>
            <Image
              src="/logo-full.svg"
              alt="To The Point Tech"
              width={640}
              height={146}
              priority
              draggable={false}
              className={cn(
                "h-auto w-[320px] select-none sm:w-[360px] md:w-[520px] lg:w-[640px]"
              )}
            />
          </div>

          {/* Text boxes */}
          <section
            className={cn(
              "mx-auto flex w-full max-w-5xl flex-col gap-3 sm:gap-4"
            )}>
            <div
              className={cn(
                "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm sm:p-4"
              )}>
              <h2 className={cn("text-russian-violet mb-1 text-3xl font-bold")}>
                About Me
              </h2>
              <p
                className={cn(
                  "text-rich-black text-lg font-medium sm:text-xl"
                )}>
                Hi there, I’m Harrison. I’m a computer science graduate from
                Point Chevalier, eager to apply my practical tech skills to
                benefit the community. I grew up here and want to make
                technology more straightforward and less stressful for people
                who don’t have a go-to tech person.
              </p>
              <ul
                className={cn(
                  "text-rich-black mt-3 list-disc pl-5 text-base sm:text-lg"
                )}>
                <li>Plain-English explanations and zero jargon</li>
                <li>Clear written notes and simple next steps</li>
                <li>Privacy-first and careful with your data</li>
                <li>Local to Point Chevalier; evenings/weekends available</li>
                <li>House calls and secure remote support</li>
              </ul>
            </div>

            <div
              className={cn(
                "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm sm:p-4"
              )}>
              <h2
                className={cn(
                  "text-russian-violet mb-1 text-3xl font-bold sm:mb-2"
                )}>
                Services
              </h2>
              <p
                className={cn(
                  "text-rich-black mb-2 text-lg font-medium sm:mb-3 sm:text-xl"
                )}>
                If you’ve got a tech issue, I’ve got you covered. I fix slow
                computers, set up new phones and laptops, sort Wi-Fi and network
                connections, connect printers and TVs, and ensure cloud backups
                and email run reliably. I can secure your devices, remove scams
                and malware, and move photos and files safely between devices. I
                will explain everything in plain language, leave clear notes,
                and not upsell. I’m local, flexible with evenings/weekends, and
                can help in person or remotely.
              </p>
              <ul
                className={cn(
                  "text-rich-black list-disc pl-5 text-base sm:text-lg"
                )}>
                <li>
                  Quick diagnosis, options with pros/cons before work starts
                </li>
                <li>Up-front pricing and no surprise add-ons</li>
                <li>
                  Data-safe approach: important files backed up before changes
                </li>
                <li>Clean handover: what changed and how to manage it</li>
                <li>On-site nearby or remote if it’s faster</li>
              </ul>
              <p
                className={cn(
                  "text-rich-black mb-2 text-lg font-medium sm:mb-3 sm:text-xl"
                )}>
                <br />
                Please message or email me to let me know what’s going on, and
                we’ll book a time that suits you.
              </p>
            </div>
          </section>

          {/* Support grid */}
          <section
            aria-labelledby="support"
            className={cn("mx-auto mt-4 w-full max-w-5xl sm:mt-6")}>
            <h2
              id="support"
              className={cn(
                "text-rich-black mb-2 text-center text-2xl font-semibold sm:text-3xl"
              )}>
              Areas I Can Help With
            </h2>

            <ul
              className={cn(
                "mx-auto grid w-full max-w-[68rem] grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4"
              )}>
              {supportItems.map(({ label, icon: Icon }) => (
                <li
                  key={label}
                  className={cn(
                    "bg-seasalt-800 border-seasalt-400/60",
                    "flex h-16 w-full min-w-0 items-center gap-2",
                    "rounded-md border px-2"
                  )}>
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-md",
                      "border-moonstone-500/30 bg-moonstone-600/15 border sm:size-10"
                    )}>
                    <Icon
                      className="text-moonstone-600 h-6 w-6 sm:h-7 sm:w-7"
                      aria-hidden
                    />
                  </span>

                  <span
                    className={cn(
                      "text-rich-black min-w-0 text-left leading-tight font-semibold",
                      "line-clamp-2 text-base [overflow-wrap:anywhere] sm:text-[17px] md:text-lg"
                    )}>
                    {label}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Footer */}
        <footer
          className={cn("mx-auto mt-4 w-fit max-w-[calc(100vw-2rem)] sm:mt-6")}>
          <div
            className={cn(
              "border-seasalt-400/40 bg-seasalt-800/70 flex flex-col items-stretch gap-3 rounded-lg border p-3 backdrop-blur-md sm:flex-row sm:items-center sm:gap-6 sm:px-4 sm:py-3"
            )}>
            <a
              href="tel:+64212971237"
              className={cn(
                "text-russian-violet hover:text-coquelicot-500 flex items-center gap-2 rounded-md px-3 py-2 text-lg font-semibold"
              )}>
              <FaPhone
                className={cn(
                  "pointer-events-none h-7 w-7 shrink-0 select-none"
                )}
                aria-hidden
              />
              <span>+64 21 297 1237</span>
            </a>
            <div className={cn("bg-seasalt-400/50 hidden h-5 w-px sm:block")} />
            <a
              href="mailto:harrisonraynes8@gmail.com"
              className={cn(
                "text-russian-violet hover:text-coquelicot-500 flex items-center gap-2 rounded-md px-3 py-2 text-lg font-semibold"
              )}>
              <FaEnvelope
                className={cn(
                  "pointer-events-none h-7 w-7 shrink-0 select-none"
                )}
                aria-hidden
              />
              <span>harrisonraynes8@gmail.com</span>
            </a>
          </div>
        </footer>
      </div>
    </main>
  );
}
