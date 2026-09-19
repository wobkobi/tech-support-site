// src/app/services/page.tsx
// Services page: full list of service categories.

import { getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import { BreadcrumbJsonLd } from "@/shared/components/BreadcrumbJsonLd";
import { Bullet } from "@/shared/components/Bullet";
import { Button } from "@/shared/components/Button";
import { CARD, FrostedSection, NESTED_CARD, PageShell } from "@/shared/components/PageLayout";
import { PixelEvent } from "@/shared/components/PixelEvent";
import { cn } from "@/shared/lib/cn";
import { SERVICE_AREAS } from "@/shared/lib/service-areas";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Metadata } from "next";
import type React from "react";
import { Fragment } from "react";

// ISR so rate edits propagate via the rate-config tag purge instead of
// requiring a redeploy (the page was previously baked at build time).
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Tech Support Services - Computers, Wi-Fi, Phones & More",
  description:
    "On-site and remote tech support across Auckland: computer and laptop repair, Wi-Fi setup, virus removal, data recovery, smart TVs, printers, email, cloud backup and small business IT.",
  alternates: { canonical: "/services" },
  openGraph: {
    title: "Tech Support Services - To the Point Tech",
    description:
      "Computer repair, Wi-Fi setup, data recovery, smart home, printers, email and more across Auckland.",
    url: "/services",
  },
};

const siteUrl = getSiteUrl();

/**
 * Lets a slash-joined example ("Chromecast/AirPlay") wrap after a slash. Browsers
 * treat the whole run as one word, so the half-width phone column otherwise
 * breaks it mid-word.
 * @param text - Example text.
 * @returns The text with a break opportunity after each slash.
 */
function breakAfterSlashes(text: string): React.ReactNode {
  const parts = text.split("/");
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <>
          /<wbr />
        </>
      )}
    </Fragment>
  ));
}

/**
 * Services page component
 * @returns Services page element
 */
export default async function ServicesPage(): Promise<React.ReactElement> {
  const pricing = await getPublicPricing();
  const servicesJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "To the Point Tech - Services",
    itemListElement: SERVICE_AREAS.map((area, idx) => ({
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
      <PixelEvent event="ViewContent" />
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
        <div className="flex flex-col gap-6 sm:gap-8">
          <section aria-labelledby="services-heading" className={cn(CARD, "animate-fade-in")}>
            <h1
              id="services-heading"
              className="mb-4 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl"
            >
              Services
            </h1>

            <p className="mb-4 text-base text-rich-black sm:text-lg">
              I help with the everyday tech problems no matter how big or small. The goal is to get
              things working reliably and leave you with a setup you understand.
            </p>

            <p className="text-base text-rich-black/90 sm:text-lg">
              I'll explain what I'm doing as I go, and I can leave you notes on what changed so you
              know how to handle it next time.
            </p>
          </section>

          <section
            aria-labelledby="areas-heading"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}
          >
            <h2
              id="areas-heading"
              className="mb-3 text-xl font-bold text-russian-violet sm:text-2xl"
            >
              What I help with
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4">
              {SERVICE_AREAS.map(({ slug, label, icon: Icon, examples }) => (
                // id is the anchor the home page's service tiles link to;
                // scroll-mt clears the fixed nav on the jump.
                <div key={slug} id={slug} className={cn(NESTED_CARD, "scroll-mt-24")}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-moonstone-500/40 bg-moonstone-400/20">
                      <Icon className="text-2xl text-moonstone-400" aria-hidden />
                    </span>
                    <h3 className="text-lg font-semibold text-rich-black sm:text-xl">{label}</h3>
                  </div>
                  {/* Two columns on phones: the examples are two or three words
                      each, so a single column left most of the width empty. */}
                  <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-base text-rich-black/80 sm:grid-cols-1 sm:text-lg">
                    {examples.map((example) => (
                      <li key={example} className="flex gap-2">
                        <Bullet />
                        <span className="min-w-0 wrap-break-word">
                          {breakAfterSlashes(example)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <p className="mt-6 text-base text-rich-black/90 sm:text-lg">
              Not sure which category your problem fits? That's fine. Just describe what's happening
              and I'll figure out the best approach.
            </p>
          </section>

          <div className="grid gap-5 md:grid-cols-2">
            <section
              aria-labelledby="home-heading"
              className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-200")}
            >
              <h2
                id="home-heading"
                className="mb-3 text-xl font-bold text-russian-violet sm:text-2xl"
              >
                For home users
              </h2>

              <p className="mb-3 text-base text-rich-black sm:text-lg">
                Common home visits include:
              </p>

              <ul className="space-y-2 text-base text-rich-black/90 sm:text-lg">
                <li className="flex gap-2">
                  <Bullet />
                  <span>Setting up a new laptop, phone, or tablet with all your accounts</span>
                </li>
                <li className="flex gap-2">
                  <Bullet />
                  <span>Fixing Wi-Fi dead spots or unreliable connections</span>
                </li>
                <li className="flex gap-2">
                  <Bullet />
                  <span>Organising and backing up photos to the cloud</span>
                </li>
                <li className="flex gap-2">
                  <Bullet />
                  <span>Helping parents or grandparents get comfortable with devices</span>
                </li>
                <li className="flex gap-2">
                  <Bullet />
                  <span>Sorting out email and account login issues</span>
                </li>
                <li className="flex gap-2">
                  <Bullet />
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
                className="mb-3 text-xl font-bold text-russian-violet sm:text-2xl"
              >
                For small businesses
              </h2>

              <p className="mb-3 text-base text-rich-black sm:text-lg">
                Light IT support for sole traders and small teams:
              </p>

              <ul className="space-y-2 text-base text-rich-black/90 sm:text-lg">
                <li className="flex gap-2">
                  <Bullet />
                  <span>Setting up workstations, email, and shared files</span>
                </li>
                <li className="flex gap-2">
                  <Bullet />
                  <span>Basic network and Wi-Fi improvements</span>
                </li>
                <li className="flex gap-2">
                  <Bullet />
                  <span>Backup and security checks</span>
                </li>
                <li className="flex gap-2">
                  <Bullet />
                  <span>New staff device setup</span>
                </li>
                <li className="flex gap-2">
                  <Bullet />
                  <span>One-off projects like office moves</span>
                </li>
              </ul>

              <p className="mt-3 text-base text-rich-black/90 sm:text-lg">
                No lock-in required - call when you need help, or set up a monthly retainer for
                ongoing cover.
              </p>

              <div className="mt-4">
                <Button href="/business" variant="tertiary" size="md">
                  Business IT support
                </Button>
              </div>
            </section>
          </div>

          <section
            aria-label="Next steps"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-400 text-center")}
          >
            <p className="mb-4 text-base text-rich-black sm:text-lg">Ready to get started?</p>
            <div className="flex flex-wrap items-center justify-center gap-3">
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
