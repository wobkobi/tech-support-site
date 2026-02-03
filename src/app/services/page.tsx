// src/app/services/page.tsx
/**
 * Services page: detailed overview of what To The Point Tech offers.
 */

import type React from "react";
import { FrostedSection, PageShell } from "@/components/SiteFrame";
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

interface ServiceCategory {
  label: string;
  summary: string;
  audience: "home" | "business" | "both";
  items: ReadonlyArray<string>;
}

const serviceCategories: ReadonlyArray<ServiceCategory> = [
  {
    label: "New device setup",
    summary:
      "Get new computers, phones, and tablets ready to use with everything in the right place.",
    audience: "both",
    items: [
      "Initial setup and updates",
      "Connecting to Wi-Fi and printers",
      "Installing essential apps",
      "Setting up email and accounts",
    ],
  },
  {
    label: "Wi-Fi and internet",
    summary:
      "Fix dropouts, extend coverage, and make sure your home or small office network is stable.",
    audience: "both",
    items: [
      "Diagnosing slow or unreliable Wi-Fi",
      "Best placement for modems and access points",
      "Mesh Wi-Fi and extenders",
      "Small office network checks",
    ],
  },
  {
    label: "Backups and storage",
    summary: "Make sure important files and photos are safely backed up and easy to find.",
    audience: "both",
    items: [
      "External drive setup",
      "Cloud backup (OneDrive, Google Drive, iCloud, etc.)",
      "Simple folder and file organisation",
      "Basic backup checks and guidance",
    ],
  },
  {
    label: "Email and accounts",
    summary: "Help with login issues, account recovery, and keeping track of where things live.",
    audience: "both",
    items: [
      "Setting up email on new devices",
      "Tidying inboxes and folders",
      "Password manager basics",
      "Account recovery and security checks",
    ],
  },
  {
    label: "Smart home and entertainment",
    summary: "Get TVs, streaming boxes, speakers, and smart devices talking to each other.",
    audience: "home",
    items: [
      "Smart TV and streaming app setup",
      "Speakers and casting (Chromecast, AirPlay, etc.)",
      "Smart lights, plugs, cameras, and hubs",
      "Making remotes and apps easier to use",
    ],
  },
  {
    label: "Small business support",
    summary:
      "Lightweight IT support for sole traders and small teams without a full-time IT department.",
    audience: "business",
    items: [
      "Email and domain setup",
      "Basic shared file storage",
      "Workstation setup and tidy-up",
      "Simple security and backup checks",
    ],
  },
];

interface IconFeature {
  icon: React.ReactElement;
  label: string;
  description: string;
}

const featureIcons: ReadonlyArray<IconFeature> = [
  {
    icon: <FaLaptop />,
    label: "Computers",
    description: "Windows laptops and desktops for home and work.",
  },
  {
    icon: <FaMobileScreen />,
    label: "Phones & tablets",
    description: "Android and iOS setup, sync, and cleanup.",
  },
  {
    icon: <FaWifi />,
    label: "Wi-Fi & internet",
    description: "Coverage, speed, and stability improvements.",
  },
  {
    icon: <FaTv />,
    label: "TV & streaming",
    description: "Smart TVs, streaming boxes, and logins.",
  },
  { icon: <FaHouse />, label: "Smart home", description: "Lights, plugs, cameras, and hubs." },
  {
    icon: <FaPrint />,
    label: "Printers & scanners",
    description: "Getting them online and behaving.",
  },
  {
    icon: <FaCloud />,
    label: "Cloud & backups",
    description: "Keeping important files safely backed up.",
  },
  {
    icon: <FaImages />,
    label: "Photos & storage",
    description: "Gathering, sorting, and backing up photos.",
  },
  {
    icon: <FaRightLeft />,
    label: "Setup & transfer",
    description: "Moving from old devices to new ones.",
  },
  {
    icon: <FaToolbox />,
    label: "Tune-ups & repairs",
    description: "General tidy-ups and basic repairs.",
  },
  {
    icon: <FaShieldHalved />,
    label: "Safety & security",
    description: "Updates, passwords, and safer habits.",
  },
];

const pageMain = cn(
  "mx-auto flex w-full max-w-6xl flex-col gap-6 sm:gap-8",
  "pt-4 sm:pt-6 pb-6 sm:pb-8",
);

const card = cn("border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm sm:p-6");
const softCard = cn(
  "border-seasalt-400/60 bg-seasalt-900/60 rounded-xl border p-3 shadow-sm sm:p-4",
);
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
      <FrostedSection>
        <main className={pageMain}>
          <section aria-labelledby="services-hero-heading" className={card}>
            <h1
              id="services-hero-heading"
              className={cn(
                "text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Services
            </h1>

            <p className={cn("text-rich-black mb-3 max-w-3xl text-sm sm:text-base")}>
              I help with the real-world tech jobs that sit between turning it off and on again and
              a full-time IT department. The goal is to get things working reliably and make them
              easier to live with.
            </p>

            <p className={cn("text-rich-black/80 max-w-3xl text-sm sm:text-base")}>
              Every visit includes clear explanations in plain English, and I can leave simple notes
              so you know what changed and how to use things next time.
            </p>
          </section>

          <section aria-labelledby="service-areas-heading" className={card}>
            <div className={cn("mb-3 flex items-center justify-between gap-3")}>
              <h2
                id="service-areas-heading"
                className={cn("text-rich-black text-lg font-semibold sm:text-xl")}
              >
                What I work on
              </h2>
              <Link href="/" className={cn(linkStyle, "text-xs font-semibold sm:text-sm")}>
                Back to home
              </Link>
            </div>

            <p className={cn("text-rich-black/80 mb-4 max-w-3xl text-sm sm:text-base")}>
              Most visits include a mix of these areas. It is completely fine if you are not sure
              which category your problem fits into.
            </p>

            <ul
              className={cn(
                "grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 md:grid-cols-4 lg:grid-cols-5",
              )}
            >
              {featureIcons.map((feature) => (
                <li key={feature.label} className={softCard}>
                  <div className={cn("flex items-start gap-3")}>
                    <span
                      className={cn(
                        "border-moonstone-500/30 bg-moonstone-600/15 grid size-9 shrink-0 place-items-center rounded-md border",
                      )}
                    >
                      <span className={cn("text-moonstone-600 text-lg")} aria-hidden>
                        {feature.icon}
                      </span>
                    </span>

                    <div className={cn("min-w-0")}>
                      <p className={cn("text-rich-black text-sm font-semibold")}>{feature.label}</p>
                      <p className={cn("text-rich-black/80 text-xs")}>{feature.description}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="service-categories-heading" className={card}>
            <h2
              id="service-categories-heading"
              className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}
            >
              Examples of work
            </h2>

            <p className={cn("text-rich-black/80 mb-4 max-w-3xl text-sm sm:text-base")}>
              Below are some common visit types. Actual jobs are flexible and built around what you
              need on the day.
            </p>

            <div
              className={cn(
                "grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 md:grid-cols-3 md:gap-5",
              )}
            >
              {serviceCategories.map((category) => (
                <article key={category.label} className={softCard}>
                  <h3 className={cn("text-russian-violet mb-1 text-sm font-semibold sm:text-base")}>
                    {category.label}
                  </h3>

                  <p className={cn("text-rich-black/90 mb-2 text-xs sm:text-sm")}>
                    {category.summary}
                  </p>

                  <ul
                    className={cn("text-rich-black/90 list-disc space-y-1 pl-5 text-xs sm:text-sm")}
                  >
                    {category.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>

                  <p className={cn("text-rich-black/70 mt-2 text-[11px] sm:text-xs")}>
                    Audience:{" "}
                    {category.audience === "home"
                      ? "home"
                      : category.audience === "business"
                        ? "small business"
                        : "home and small business"}
                    .
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="pricing-heading" className={card}>
            <h2
              id="pricing-heading"
              className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}
            >
              Pricing and next steps
            </h2>

            <p className={cn("text-rich-black mb-2 max-w-3xl text-sm sm:text-base")}>
              Most visits are based on a simple hourly rate with a minimum call-out. For
              straightforward jobs (such as setting up a single new device) the work is often
              finished within that minimum.
            </p>

            <ul className={cn("text-rich-black/90 mb-2 list-disc space-y-1 pl-5 text-sm")}>
              <li>Home visits: typically one to two hours for common jobs.</li>
              <li>Small business visits: often two hours or more, depending on equipment.</li>
              <li>Remote help: shorter sessions for quick fixes and follow-ups.</li>
            </ul>

            <p className={cn("text-rich-black/80 mb-3 max-w-3xl text-sm sm:text-base")}>
              When you contact me, I will give you a clear idea of time and cost before we book
              anything in. Larger jobs can be split into stages so you can decide how far to go.
            </p>

            <p className={cn("text-rich-black text-sm sm:text-base")}>
              You can{" "}
              <Link href="/contact" className={linkStyle}>
                get in touch via the contact page
              </Link>{" "}
              with a quick description of what you need help with.
            </p>
          </section>
        </main>
      </FrostedSection>
    </PageShell>
  );
}
