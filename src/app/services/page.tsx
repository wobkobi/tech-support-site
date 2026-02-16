// src/app/services/page.tsx
/**
 * Services page: what To The Point Tech can help with.
 */

import type React from "react";
import { FrostedSection, PageShell, CARD, SOFT_CARD } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";
import Link from "next/link";
import {
  FaCloud,
  FaHouse,
  FaImages,
  FaLaptop,
  FaMobileScreen,
  FaPrint,
  FaRightLeft,
  FaShieldHalved,
  FaToolbox,
  FaTv,
  FaWifi,
} from "react-icons/fa6";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ServiceArea {
  icon: React.ReactElement;
  label: string;
  examples: string[];
}

const serviceAreas: ReadonlyArray<ServiceArea> = [
  {
    icon: <FaLaptop />,
    label: "Computers",
    examples: ["Slow PC fixes", "Software installs", "Virus cleanup", "General tune-ups"],
  },
  {
    icon: <FaMobileScreen />,
    label: "Phones & tablets",
    examples: ["New device setup", "Data transfer", "App help", "Account sync"],
  },
  {
    icon: <FaWifi />,
    label: "Wi-Fi & internet",
    examples: ["Fixing dropouts", "Extending coverage", "Router setup", "Speed issues"],
  },
  {
    icon: <FaTv />,
    label: "TV & streaming",
    examples: ["Smart TV setup", "Streaming apps", "Chromecast/AirPlay", "Sound systems"],
  },
  {
    icon: <FaHouse />,
    label: "Smart home",
    examples: ["Smart lights", "Security cameras", "Voice assistants", "App setup"],
  },
  {
    icon: <FaPrint />,
    label: "Printers & scanners",
    examples: ["Getting online", "Driver issues", "Network printing", "Scan setup"],
  },
  {
    icon: <FaCloud />,
    label: "Cloud & backups",
    examples: ["OneDrive/iCloud/Google", "External drives", "Auto-backup setup", "Recovery"],
  },
  {
    icon: <FaImages />,
    label: "Photos & storage",
    examples: ["Organising photos", "Freeing space", "Photo backup", "File management"],
  },
  {
    icon: <FaRightLeft />,
    label: "Setup & transfer",
    examples: ["New device migration", "Old to new PC", "Email setup", "Account moves"],
  },
  {
    icon: <FaToolbox />,
    label: "Tune-ups & repairs",
    examples: ["Speed improvements", "Update installs", "Cleanup", "Basic repairs"],
  },
  {
    icon: <FaShieldHalved />,
    label: "Security",
    examples: ["Password help", "Scam removal", "Safety checks", "Secure setup"],
  },
];

const linkStyle = cn(
  "text-coquelicot-500 hover:text-coquelicot-600 underline-offset-4 hover:underline",
);

/**
 * Services page component.
 * @returns React element for the services page.
 */
export default function ServicesPage(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection maxWidth="64rem">
        <div className={cn("flex flex-col gap-4 sm:gap-5")}>
          <section aria-labelledby="services-heading" className={cn(CARD)}>
            <h1
              id="services-heading"
              className={cn(
                "text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Services
            </h1>

            <p className={cn("text-rich-black mb-3 text-sm sm:text-base")}>
              I help with the everyday tech problems that sit between "turn it off and on again" and
              calling a big IT company. The goal is to get things working reliably and leave you
              with a setup you understand.
            </p>

            <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
              Every job includes clear explanations in plain English, and I can leave notes so you
              know what changed and how to handle things next time.
            </p>
          </section>

          <section aria-labelledby="areas-heading" className={cn(CARD)}>
            <h2
              id="areas-heading"
              className={cn("text-rich-black mb-3 text-lg font-semibold sm:text-xl")}
            >
              What I help with
            </h2>

            <div
              className={cn(
                "grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 md:grid-cols-3 lg:grid-cols-4",
              )}
            >
              {serviceAreas.map((area) => (
                <div key={area.label} className={cn(SOFT_CARD)}>
                  <div className={cn("flex items-start gap-3")}>
                    <span
                      className={cn(
                        "border-moonstone-500/30 bg-moonstone-600/15 grid size-10 shrink-0 place-items-center rounded-md border",
                      )}
                    >
                      <span className={cn("text-moonstone-600 text-lg")} aria-hidden>
                        {area.icon}
                      </span>
                    </span>
                    <div className={cn("min-w-0")}>
                      <p className={cn("text-rich-black text-sm font-semibold")}>{area.label}</p>
                      <p className={cn("text-rich-black/70 text-xs")}>
                        {area.examples.join(" · ")}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <p className={cn("text-rich-black/80 mt-4 text-sm sm:text-base")}>
              Not sure which category your problem fits? That's fine—just describe what's happening
              and I'll figure out the best approach.
            </p>
          </section>

          <section aria-labelledby="home-heading" className={cn(CARD)}>
            <h2
              id="home-heading"
              className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}
            >
              For home users
            </h2>

            <p className={cn("text-rich-black mb-3 text-sm sm:text-base")}>
              Common home visits include:
            </p>

            <ul className={cn("text-rich-black/90 list-disc space-y-1 pl-5 text-sm sm:text-base")}>
              <li>Setting up a new laptop, phone, or tablet with all your accounts and apps</li>
              <li>Fixing Wi-Fi dead spots or unreliable connections</li>
              <li>Organising and backing up photos to the cloud or an external drive</li>
              <li>Helping parents or grandparents get comfortable with their devices</li>
              <li>Sorting out email and account login issues</li>
              <li>Removing unwanted software, scams, or malware</li>
            </ul>
          </section>

          <section aria-labelledby="business-heading" className={cn(CARD)}>
            <h2
              id="business-heading"
              className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}
            >
              For small businesses
            </h2>

            <p className={cn("text-rich-black mb-3 text-sm sm:text-base")}>
              Light IT support for sole traders and small teams who don't need (or want) a full IT
              contract:
            </p>

            <ul className={cn("text-rich-black/90 list-disc space-y-1 pl-5 text-sm sm:text-base")}>
              <li>Setting up workstations, email, and shared files</li>
              <li>Basic network and Wi-Fi improvements</li>
              <li>Backup and security checks</li>
              <li>New staff device setup</li>
              <li>One-off projects like office moves or system refreshes</li>
            </ul>

            <p className={cn("text-rich-black/80 mt-3 text-sm sm:text-base")}>
              No ongoing contracts required. You call when you need help.
            </p>
          </section>

          <section aria-label="Next steps" className={cn(CARD)}>
            <p className={cn("text-rich-black text-sm sm:text-base")}>
              See the{" "}
              <Link href="/pricing" className={linkStyle}>
                pricing page
              </Link>{" "}
              for how billing works, or{" "}
              <Link href="/contact" className={linkStyle}>
                get in touch
              </Link>{" "}
              to describe what you need.
            </p>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
