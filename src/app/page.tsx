// src/app/page.tsx
/**
 * Mobile-first landing with:
 * - Frosted logo panel (content-sized)
 * - Stacked info cards that sit OUTSIDE the frosted panel
 * - Support grid that auto-fits (1→3→5 cols) and matches the info width
 * - Cards sized to tidy rectangles, not wild aspect ratios
 */

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
    <main className="relative min-h-dvh overflow-hidden">
      {/* Backdrop*/}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <Image
          src="/backdrop.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="scale-110 transform-gpu object-cover blur select-none"
        />
      </div>

      {/* Frosted container  */}
      <div className="mx-auto my-4 w-full max-w-[min(100vw-2rem,68rem)] sm:my-8">
        <div className="border-seasalt-400/40 bg-seasalt-800/60 rounded-2xl border p-4 shadow-lg backdrop-blur-xl sm:p-8">
          {/* Logo */}
          <div className="grid place-items-center pb-4 sm:pb-6">
            <Image
              src="/logo-full.svg"
              alt="To The Point Tech"
              width={640}
              height={146}
              priority
              className="h-auto w-[240px] max-w-full sm:w-[360px] md:w-[520px] lg:w-[640px]"
            />
          </div>

          {/* Text boxes */}
          <section className="mx-auto flex w-full max-w-5xl flex-col gap-3 sm:gap-4">
            <div className="border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm sm:p-4">
              <h2 className="text-russian-violet mb-1 text-2xl font-semibold">
                About Me
              </h2>
              <p className="text-rich-black text-base sm:text-lg">
                Hi there, I'm Harrison. I am a computer science graduate looking
                to get started by helping in the community. I live and grew up
                in Point Chevalier, and I'm looking to contribute to the
                community with the skills I have.
              </p>
            </div>

            <div className="border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm sm:p-4">
              <h2 className="text-russian-violet mb-1 text-2xl font-semibold sm:mb-2">
                Services
              </h2>
              <p className="text-rich-black mb-2 text-base sm:mb-3 sm:text-lg">
                If you have any tech issues, I've got you covered. No problem is
                too small. I am happy to help with any issue. Please feel free
                to contact me, and we can arrange a time to meet.
              </p>
            </div>
          </section>

          {/* Support grid */}
          <section
            aria-labelledby="support"
            className="mx-auto mt-4 w-full max-w-5xl sm:mt-6">
            <h2
              id="support"
              className="text-rich-black mb-2 text-xl font-semibold sm:text-2xl">
              What I support
            </h2>

            <ul className="mx-auto grid w-full max-w-[68rem] grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
              {supportItems.map(({ label, icon: Icon }) => (
                <li
                  key={label}
                  className="border-seasalt-400/60 bg-seasalt-800 flex w-full min-w-0 items-center gap-3 rounded-lg border p-3 sm:p-4">
                  <span className="bg-moonstone-600/20 text-moonstone-600 grid size-10 place-items-center rounded-md sm:size-12">
                    <Icon className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden />
                  </span>
                  <span className="text-rich-black min-w-0 text-base break-words sm:text-lg">
                    {label}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Footer */}
        <footer className="mx-auto mt-4 w-fit max-w-[calc(100vw-2rem)] sm:mt-6">
          <div className="border-seasalt-400/40 bg-seasalt-800/70 flex flex-col items-stretch gap-3 rounded-lg border p-3 backdrop-blur-md sm:flex-row sm:items-center sm:gap-6 sm:px-4 sm:py-3">
            <a
              href="tel:+64212971237"
              className="text-russian-violet hover:text-coquelicot-500 flex items-center gap-2 rounded-md px-3 py-2 text-base font-semibold">
              <FaPhone className="h-5 w-5 shrink-0" aria-hidden />
              <span>+64 21 297 1237</span>
            </a>
            <div className="bg-seasalt-400/50 hidden h-5 w-px sm:block" />
            <a
              href="mailto:harrisonraynes8@gmail.com"
              className="text-russian-violet hover:text-coquelicot-500 flex items-center gap-2 rounded-md px-3 py-2 text-base font-semibold">
              <FaEnvelope className="h-5 w-5 shrink-0" aria-hidden />
              <span>harrisonraynes8@gmail.com</span>
            </a>
          </div>
        </footer>
      </div>
    </main>
  );
}
