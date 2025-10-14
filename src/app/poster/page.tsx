// src/app/older/page.tsx
/**
 * Older-users variant:
 * - Larger type and controls (~+1-2 steps)
 * - Taller cards and bigger icon boxes
 * - More generous spacing for tap targets
 * - Keeps commented-out blocks
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
          "mx-auto my-5 w-full max-w-[min(100vw-2rem,68rem)] sm:my-10"
        )}>
        <div
          className={cn(
            "border-seasalt-400/40 bg-seasalt-800/60 rounded-2xl border p-5 shadow-lg backdrop-blur-xl sm:p-10"
          )}>
          {/* Logo */}
          <div className={cn("grid place-items-center pb-5 sm:pb-7")}>
            <Image
              src="/logo-full.svg"
              alt="To The Point Tech"
              width={800}
              height={182}
              priority
              draggable={false}
              className={cn(
                "h-auto w-[380px] select-none sm:w-[420px] md:w-[560px] lg:w-[700px]"
              )}
            />
          </div>

          {/* Text boxes */}
          <section
            className={cn(
              "mx-auto flex w-full max-w-5xl flex-col gap-4 sm:gap-5"
            )}>
            <div
              className={cn(
                "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-5 shadow-sm sm:p-6"
              )}>
              <h2 className={cn("text-russian-violet mb-2 text-4xl font-bold")}>
                About Me
              </h2>
              <p
                className={cn(
                  "text-rich-black text-xl font-medium sm:text-2xl"
                )}>
                Hi there, I'm Harrison. I'm a computer science graduate from
                Point Chevalier, eager to apply my practical tech skills to
                benefit the community. I grew up here and want to make
                technology more straightforward and less stressful for people
                who don't have a go-to tech person.
              </p>
            </div>

            <div
              className={cn(
                "border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-5 shadow-sm sm:p-6"
              )}>
              <h2
                className={cn(
                  "text-russian-violet mb-2 text-4xl font-bold sm:mb-3"
                )}>
                Services
              </h2>
              <p
                className={cn(
                  "text-rich-black mb-3 text-xl font-medium sm:mb-4 sm:text-2xl"
                )}>
                If you've got a tech issue, I've got you covered. I fix slow
                computers, set up new phones and laptops, sort Wi-Fi and network
                connections, connect printers and TVs, and ensure cloud backups
                and email run reliably. I can secure your devices, remove scams
                and malware, and move photos and files safely between devices. I
                will explain everything in plain language, leave clear notes,
                and not upsell. I'm local, flexible with evenings/weekends, and
                can help in person or remotely.
              </p>
              <p
                className={cn(
                  "text-rich-black mb-3 text-xl font-medium sm:mb-4 sm:text-2xl"
                )}>
                <br />
                Please message or email me to let me know what's going on, and
                we'll book a time that suits you.
              </p>
            </div>
          </section>

          {/* Support grid */}
          <section
            aria-labelledby="support"
            className={cn("mx-auto mt-5 w-full max-w-5xl sm:mt-7")}>
            <h2
              id="support"
              className={cn(
                "text-rich-black mb-3 text-center text-3xl font-semibold sm:text-4xl"
              )}>
              Areas I Can Help With
            </h2>

            <ul
              className={cn(
                "mx-auto grid w-full max-w-[68rem] grid-cols-2 gap-3 sm:grid-cols-2 sm:gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4"
              )}>
              {supportItems.map(({ label, icon: Icon }) => (
                <li
                  key={label}
                  className={cn(
                    "border-seasalt-400/60 bg-seasalt-800 rounded-lg border",
                    "flex h-20 w-full min-w-0 items-center gap-3 px-3 sm:gap-4 sm:px-4"
                  )}>
                  <span
                    className={cn(
                      "grid size-12 shrink-0 place-items-center rounded-md",
                      "border-moonstone-500/30 bg-moonstone-600/15 border md:size-14"
                    )}>
                    <Icon
                      className={cn("text-moonstone-600 h-7 w-7 sm:h-8 sm:w-8")}
                      aria-hidden
                    />
                  </span>

                  <span
                    className={cn(
                      "text-rich-black min-w-0 text-left leading-tight font-semibold",
                      "line-clamp-2 text-[18px] [overflow-wrap:anywhere] sm:text-[19px] md:text-[20px]"
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
          className={cn("mx-auto mt-5 w-fit max-w-[calc(100vw-2rem)] sm:mt-8")}>
          <div
            className={cn(
              "border-seasalt-400/40 bg-seasalt-800/70 rounded-lg border p-4 backdrop-blur-md sm:px-5 sm:py-4",
              "flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:gap-7"
            )}>
            <a
              href="tel:+64212971237"
              className={cn(
                "text-russian-violet hover:text-coquelicot-500",
                "flex items-center gap-3 rounded-md px-4 py-3 text-xl font-semibold"
              )}>
              <FaPhone
                className={cn(
                  "pointer-events-none h-8 w-8 shrink-0 select-none"
                )}
                aria-hidden
              />
              <span>+64 21 297 1237</span>
            </a>
            <div className={cn("bg-seasalt-400/50 hidden h-6 w-px sm:block")} />
            <a
              href="mailto:harrisonraynes8@gmail.com"
              className={cn(
                "text-russian-violet hover:text-coquelicot-500",
                "flex items-center gap-3 rounded-md px-4 py-3 text-xl font-semibold"
              )}>
              <FaEnvelope
                className={cn(
                  "pointer-events-none h-8 w-8 shrink-0 select-none"
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
