// src/app/services/page.tsx
/**
 * @file page.tsx
 * @description Services page: full list of service categories.
 */

import { getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import { BreadcrumbJsonLd } from "@/shared/components/BreadcrumbJsonLd";
import { Button } from "@/shared/components/Button";
import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Metadata } from "next";
import type React from "react";
import {
  FaCloud,
  FaEnvelope,
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

export const metadata: Metadata = {
  title: "Tech Support Services - Computers, Wi-Fi, Phones & More",
  description:
    "On-site and remote tech support across Auckland: computer and laptop repair, Wi-Fi setup, virus removal, data recovery, smart TVs, printers, email, cloud backup and small business IT.",
  alternates: { canonical: "/services" },
  openGraph: {
    title: "Tech Support Services - To The Point Tech",
    description:
      "Computer repair, Wi-Fi setup, data recovery, smart home, printers, email and more across Auckland's Inner West.",
    url: "/services",
  },
};

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

const siteUrl = getSiteUrl();

/**
 * Services page component
 * @returns Services page element
 */
export default async function ServicesPage(): Promise<React.ReactElement> {
  const pricing = await getPublicPricing();
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
            price: pricing.baseRate,
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
      <script
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
      <FrostedSection>
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section aria-labelledby="services-heading" className={cn(CARD, "animate-fade-in")}>
            <h1
              id="services-heading"
              className={cn(
                "mb-4 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl",
              )}
            >
              Services
            </h1>

            <p className={cn("mb-4 text-sm text-rich-black sm:text-base")}>
              I help with the everyday tech problems no matter how big or small. The goal is to get
              things working reliably and leave you with a setup you understand.
            </p>

            <p className={cn("text-sm text-rich-black/90 sm:text-base")}>
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
              className={cn("mb-3 text-xl font-bold text-russian-violet sm:text-2xl")}
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
                    "rounded-lg border border-seasalt-400/60 bg-seasalt-800 p-3 shadow-sm transition-all hover:shadow-md",
                  )}
                >
                  <div className={cn("mb-2 flex items-center gap-2")}>
                    <span
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-lg border border-moonstone-500/40 bg-moonstone-600/20",
                      )}
                    >
                      <span className={cn("text-2xl text-moonstone-600")} aria-hidden>
                        {area.icon}
                      </span>
                    </span>
                    <h3 className={cn("text-lg font-semibold text-rich-black sm:text-xl")}>
                      {area.label}
                    </h3>
                  </div>
                  <ul className={cn("space-y-1 text-sm text-rich-black/80 sm:text-base")}>
                    {area.examples.map((example) => (
                      <li key={example} className={cn("flex gap-2")}>
                        <span className={cn("mt-0.5 text-moonstone-600")}>•</span>
                        <span>{example}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <p className={cn("mt-6 text-sm text-rich-black/90 sm:text-base")}>
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
                className={cn("mb-3 text-xl font-bold text-russian-violet sm:text-2xl")}
              >
                For home users
              </h2>

              <p className={cn("mb-3 text-sm text-rich-black sm:text-base")}>
                Common home visits include:
              </p>

              <ul className={cn("space-y-2 text-sm text-rich-black/90 sm:text-base")}>
                <li className={cn("flex gap-2")}>
                  <span className={cn("mt-1 text-moonstone-600")}>•</span>
                  <span>Setting up a new laptop, phone, or tablet with all your accounts</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("mt-1 text-moonstone-600")}>•</span>
                  <span>Fixing Wi-Fi dead spots or unreliable connections</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("mt-1 text-moonstone-600")}>•</span>
                  <span>Organising and backing up photos to the cloud</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("mt-1 text-moonstone-600")}>•</span>
                  <span>Helping parents or grandparents get comfortable with devices</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("mt-1 text-moonstone-600")}>•</span>
                  <span>Sorting out email and account login issues</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("mt-1 text-moonstone-600")}>•</span>
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
                className={cn("mb-3 text-xl font-bold text-russian-violet sm:text-2xl")}
              >
                For small businesses
              </h2>

              <p className={cn("mb-3 text-sm text-rich-black sm:text-base")}>
                Light IT support for sole traders and small teams:
              </p>

              <ul className={cn("space-y-2 text-sm text-rich-black/90 sm:text-base")}>
                <li className={cn("flex gap-2")}>
                  <span className={cn("mt-1 text-moonstone-600")}>•</span>
                  <span>Setting up workstations, email, and shared files</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("mt-1 text-moonstone-600")}>•</span>
                  <span>Basic network and Wi-Fi improvements</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("mt-1 text-moonstone-600")}>•</span>
                  <span>Backup and security checks</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("mt-1 text-moonstone-600")}>•</span>
                  <span>New staff device setup</span>
                </li>
                <li className={cn("flex gap-2")}>
                  <span className={cn("mt-1 text-moonstone-600")}>•</span>
                  <span>One-off projects like office moves</span>
                </li>
              </ul>

              <p className={cn("mt-3 text-sm text-rich-black/90 sm:text-base")}>
                No ongoing contracts required. You call when you need help.
              </p>
            </section>
          </div>

          <section
            aria-label="Next steps"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-400 text-center")}
          >
            <p className={cn("mb-4 text-sm text-rich-black sm:text-base")}>Ready to get started?</p>
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
