// src/app/services/page.tsx
/**
 * @file page.tsx
 * @description Services page with wider layout and better organization.
 */

import type { Metadata } from "next";
import type React from "react";
import Script from "next/script";
import { FrostedSection, PageShell, CARD } from "@/shared/components/PageLayout";
import { BreadcrumbJsonLd } from "@/shared/components/BreadcrumbJsonLd";
import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/lib/cn";

export const metadata: Metadata = {
  title: "Tech Support Services - Computers, Wi-Fi, Phones & More",
  description:
    "On-site and remote tech support across Auckland: computer and laptop repair, Wi-Fi setup, virus removal, data recovery, smart TVs, printers, email, cloud backup and small business IT.",
  keywords: [
    "computer repair Auckland",
    "laptop repair Auckland",
    "Wi-Fi setup Auckland",
    "virus removal Auckland",
    "data recovery Auckland",
    "printer setup Auckland",
    "smart TV setup Auckland",
    "small business IT support Auckland",
    "Mac support Auckland",
    "Windows support Auckland",
  ],
  alternates: { canonical: "/services" },
  openGraph: {
    title: "Tech Support Services - To The Point Tech",
    description:
      "Computer repair, Wi-Fi setup, data recovery, smart home, printers, email and more across Auckland's Inner West.",
    url: "/services",
  },
};
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
  FaEnvelope,
} from "react-icons/fa6";

interface ServiceArea {
  icon: React.ReactElement;
  label: string;
  examples: string[];
}

const serviceAreas: ReadonlyArray<ServiceArea> = [
  {
    icon: <FaLaptop />,
    label: "Computers & Laptops",
    examples: ["Slow PC investigation", "Software installs", "Virus cleanup", "General tune-ups"],
  },
  {
    icon: <FaMobileScreen />,
    label: "Phones & Tablets",
    examples: ["New device setup", "Data transfer", "App help", "Account sync"],
  },
  {
    icon: <FaWifi />,
    label: "Wi-Fi & Internet",
    examples: ["Fixing dropouts", "Extending coverage", "Router setup", "Speed issues"],
  },
  {
    icon: <FaTv />,
    label: "TV & Streaming",
    examples: ["Smart TV setup", "Streaming apps", "Chromecast/AirPlay", "Sound systems"],
  },
  {
    icon: <FaHouse />,
    label: "Smart Home",
    examples: ["Smart lights", "Security cameras", "Voice assistants", "App setup"],
  },
  {
    icon: <FaPrint />,
    label: "Printers & Scanners",
    examples: ["Getting online", "Driver issues", "Network printing", "Scan setup"],
  },
  {
    icon: <FaCloud />,
    label: "Cloud & Backups",
    examples: ["OneDrive/iCloud/Google", "External drives", "Auto-backup setup", "Recovery"],
  },
  {
    icon: <FaImages />,
    label: "Photos & Storage",
    examples: ["Organising photos", "Freeing space", "Photo backup", "File management"],
  },
  {
    icon: <FaRightLeft />,
    label: "Setup & Transfer",
    examples: ["New device migration", "Old to new PC", "Email setup", "Account moves"],
  },
  {
    icon: <FaToolbox />,
    label: "Tune-ups & Repairs",
    examples: ["Speed improvements", "Update installs", "Cleanup", "Basic repairs"],
  },
  {
    icon: <FaShieldHalved />,
    label: "Security",
    examples: ["Password help", "Scam removal", "Safety checks", "Secure setup"],
  },
  {
    icon: <FaEnvelope />,
    label: "Email & Accounts",
    examples: ["Email setup", "Password recovery", "Account sync", "Spam filtering"],
  },
];

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tothepoint.co.nz";

/**
 * Services page component
 * @returns Services page element
 */
export default function ServicesPage(): React.ReactElement {
  const servicesJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "To The Point Tech - Services",
    itemListElement: serviceAreas.map((area, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      item: {
        "@type": "Service",
        name: area.label,
        serviceType: area.label,
        description: `${area.label} in Auckland: ${area.examples.join(", ")}.`,
        areaServed: { "@type": "AdministrativeArea", name: "Auckland, New Zealand" },
        provider: { "@id": `${siteUrl}#business` },
        offers: {
          "@type": "Offer",
          priceCurrency: "NZD",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: 65,
            priceCurrency: "NZD",
            unitCode: "HUR",
          },
          availability: "https://schema.org/InStock",
        },
      },
    })),
  };

  return (
    <PageShell>
      <Script
        id="ld-services"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(servicesJsonLd) }}
      />
      <BreadcrumbJsonLd
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Services", path: "/services" },
        ]}
      />
      <FrostedSection maxWidth="90rem">
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section aria-labelledby="services-heading" className={cn(CARD, "animate-fade-in")}>
            <h1
              id="services-heading"
              className={cn(
                "text-russian-violet mb-4 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Services
            </h1>

            <p className={cn("text-rich-black mb-4 text-sm sm:text-base")}>
              I help with the everyday tech problems no matter how big or small. The goal is to get
              things working reliably and leave you with a setup you understand.
            </p>

            <p className={cn("text-rich-black/90 text-sm sm:text-base")}>
              Every job includes clear explanations, and I can leave notes so you know what changed
              and how to handle things next time.
            </p>
          </section>

          <section
            aria-labelledby="areas-heading"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}
          >
            <h2
              id="areas-heading"
              className={cn("text-russian-violet mb-3 text-xl font-bold sm:text-2xl")}
            >
              What I help with
            </h2>

            <div
              className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4")}
            >
              {serviceAreas.map((area) => (
                <div
                  key={area.label}
                  className={cn(
                    "border-seasalt-400/60 bg-seasalt-800 rounded-lg border p-3 shadow-sm transition-all hover:shadow-md",
                  )}
                >
                  <div className={cn("mb-2 flex items-center gap-2")}>
                    <span
                      className={cn(
                        "border-moonstone-500/40 bg-moonstone-600/20 grid size-10 shrink-0 place-items-center rounded-lg border",
                      )}
                    >
                      <span className={cn("text-moonstone-600 text-2xl")} aria-hidden>
                        {area.icon}
                      </span>
                    </span>
                    <h3 className={cn("text-rich-black text-lg font-semibold sm:text-xl")}>
                      {area.label}
                    </h3>
                  </div>
                  <ul className={cn("text-rich-black/80 space-y-1 text-sm sm:text-base")}>
                    {area.examples.map((example) => (
                      <li key={example} className={cn("flex gap-2")}>
                        <span className={cn("text-moonstone-600 mt-0.5")}>•</span>
                        <span>{example}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <p className={cn("text-rich-black/90 mt-6 text-sm sm:text-base")}>
              Not sure which category your problem fits? That's fine. Just describe what's happening
              and I'll figure out the best approach.
            </p>
          </section>

          <div className={cn("grid gap-5 md:grid-cols-2")}>
            <section
              aria-labelledby="home-heading"
              className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-200")}
            >
              <h2
                id="home-heading"
                className={cn("text-russian-violet mb-3 text-xl font-bold sm:text-2xl")}
              >
                For home users
              </h2>

              <p className={cn("text-rich-black mb-3 text-sm sm:text-base")}>
                Common home visits include:
              </p>

              <ul className={cn("text-rich-black/90 space-y-2 text-sm sm:text-base")}>
                <li className={cn("flex gap-2")}>
                  <span className={cn("text-moonstone-600 mt-1")}>•</span>
                  <span>Setting up a new laptop, phone, or tablet with all your accounts</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("text-moonstone-600 mt-1")}>•</span>
                  <span>Fixing Wi-Fi dead spots or unreliable connections</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("text-moonstone-600 mt-1")}>•</span>
                  <span>Organising and backing up photos to the cloud</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("text-moonstone-600 mt-1")}>•</span>
                  <span>Helping parents or grandparents get comfortable with devices</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("text-moonstone-600 mt-1")}>•</span>
                  <span>Sorting out email and account login issues</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("text-moonstone-600 mt-1")}>•</span>
                  <span>Removing unwanted software, scams, or malware</span>
                </li>
              </ul>
            </section>

            <section
              aria-labelledby="business-heading"
              className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-300")}
            >
              <h2
                id="business-heading"
                className={cn("text-russian-violet mb-3 text-xl font-bold sm:text-2xl")}
              >
                For small businesses
              </h2>

              <p className={cn("text-rich-black mb-3 text-sm sm:text-base")}>
                Light IT support for sole traders and small teams:
              </p>

              <ul className={cn("text-rich-black/90 space-y-2 text-sm sm:text-base")}>
                <li className={cn("flex gap-2")}>
                  <span className={cn("text-moonstone-600 mt-1")}>•</span>
                  <span>Setting up workstations, email, and shared files</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("text-moonstone-600 mt-1")}>•</span>
                  <span>Basic network and Wi-Fi improvements</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("text-moonstone-600 mt-1")}>•</span>
                  <span>Backup and security checks</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("text-moonstone-600 mt-1")}>•</span>
                  <span>New staff device setup</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("text-moonstone-600 mt-1")}>•</span>
                  <span>One-off projects like office moves</span>
                </li>
              </ul>

              <p className={cn("text-rich-black/90 mt-3 text-sm sm:text-base")}>
                No ongoing contracts required. You call when you need help.
              </p>
            </section>
          </div>

          <section
            aria-label="Next steps"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-400 text-center")}
          >
            <p className={cn("text-rich-black mb-4 text-sm sm:text-base")}>Ready to get started?</p>
            <div className={cn("flex flex-wrap items-center justify-center gap-3")}>
              <Button href="/pricing" variant="ghost" size="md">
                View pricing
              </Button>
              <Button href="/contact" variant="primary" size="md">
                Get in touch
              </Button>
            </div>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
