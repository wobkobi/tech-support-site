// src/app/services/page.tsx
// Services page: full list of service categories.

import { getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import { Button } from "@/shared/components/Button";
import { ClosingCta } from "@/shared/components/ClosingCta";
import { Notice } from "@/shared/components/Notice";
import { PageHead } from "@/shared/components/PageHead";
import { PageShell } from "@/shared/components/PageLayout";
import { PixelEvent } from "@/shared/components/PixelEvent";
import { RuledBlock, RuledGrid } from "@/shared/components/RuledGrid";
import { Section, SectionHeading } from "@/shared/components/Section";
import { TickItem, TickList } from "@/shared/components/TickList";
import { servedSuburbGroups } from "@/shared/lib/served-suburbs";
import { SERVICE_AREAS } from "@/shared/lib/service-areas";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Metadata } from "next";
import type React from "react";
import { Fragment } from "react";

// ISR so rate edits propagate via the rate-config tag purge without a redeploy.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Computer Repairs & Tech Help in Auckland",
  description:
    "Computer and laptop repairs, Wi-Fi, virus removal, data recovery, smart TVs, printers and tech help for seniors, at your home anywhere in Auckland.",
  alternates: { canonical: "/services" },
  openGraph: {
    title: "Computer Repairs & Tech Help Services - To the Point Tech",
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
  const [pricing, { identity }] = await Promise.all([getPublicPricing(), getSettings()]);
  // Same list as the JSON-LD areaServed, so the visible areas can't drift from it.
  const suburbGroups = servedSuburbGroups(identity);
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
      <PageHead
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Services", path: "/services" },
        ]}
        title="Computer Repairs & Tech Help Services"
        intro="I help with the everyday tech problems no matter how big or small. The goal is to get things working reliably and leave you with a setup you understand."
        note="I'll explain what I'm doing as I go, and I can leave you notes on what changed so you know how to handle it next time."
      />

      <Section aria-labelledby="help-heading">
        <SectionHeading eyebrow="Services" title="What I help with" id="help-heading" />
        <RuledGrid cols={4}>
          {SERVICE_AREAS.map(({ slug, label, examples }) => (
            // id is the anchor the home page's service tiles link to.
            <RuledBlock key={slug} id={slug} title={label}>
              <TickList className="gap-1.5">
                {examples.map((example) => (
                  <TickItem key={example} variant="dot">
                    <span className="min-w-0 wrap-break-word">{breakAfterSlashes(example)}</span>
                  </TickItem>
                ))}
              </TickList>
            </RuledBlock>
          ))}
        </RuledGrid>
        <Notice className="mt-8">
          Not sure which category your problem fits? That&apos;s fine. Just describe what&apos;s
          happening and I&apos;ll figure out the best approach.
        </Notice>
      </Section>

      <Section tone="grey" containerClassName="grid gap-14 md:grid-cols-2">
        <div>
          <h2 className="mb-4 text-[1.75rem] font-extrabold">For home users</h2>
          <p className="mb-3">Common home visits include:</p>
          <TickList>
            <TickItem variant="dot">
              Setting up a new laptop, phone, or tablet with all your accounts
            </TickItem>
            <TickItem variant="dot">Fixing Wi-Fi dead spots or unreliable connections</TickItem>
            <TickItem variant="dot">Organising and backing up photos to the cloud</TickItem>
            <TickItem variant="dot">Helping you get comfortable with devices</TickItem>
            <TickItem variant="dot">Sorting out email and account login issues</TickItem>
            <TickItem variant="dot">Removing unwanted software, scams, or malware</TickItem>
          </TickList>
        </div>
        <div>
          <h2 className="mb-4 text-[1.75rem] font-extrabold">For small businesses</h2>
          <p className="mb-3">Light IT support for sole traders and small teams:</p>
          <TickList>
            <TickItem variant="dot">Setting up workstations, email, and shared files</TickItem>
            <TickItem variant="dot">Basic network and Wi-Fi improvements</TickItem>
            <TickItem variant="dot">Backup and security checks</TickItem>
            <TickItem variant="dot">New staff device setup</TickItem>
            <TickItem variant="dot">One-off projects like office moves</TickItem>
          </TickList>
          <p className="mt-3">
            No lock-in required - call when you need help, or set up a monthly retainer for ongoing
            cover.
          </p>
          <div className="mt-4">
            <Button href="/business" variant="outline" size="md">
              Business IT support
            </Button>
          </div>
        </div>
      </Section>

      <Section id="seniors" aria-labelledby="seniors-heading">
        <SectionHeading title="Tech help for seniors, at home" id="seniors-heading" />
        <p className="mb-3">
          If technology isn&apos;t your thing, I come to you and go at your pace. I explain each
          step in plain English, and no question is too basic.
        </p>
        <TickList>
          <TickItem>
            Setting up a new phone, tablet or computer and moving everything across
          </TickItem>
          <TickItem>Video calls with family on FaceTime, WhatsApp or Zoom</TickItem>
          <TickItem>Spotting scam emails, texts and calls, and cleaning up after one</TickItem>
          <TickItem>Getting the TV, streaming apps and remote working the way you want</TickItem>
          <TickItem>
            Written notes if you&apos;d like them, so you can do it again yourself
          </TickItem>
        </TickList>
        <p className="mt-4 font-bold">
          Booking for a parent or relative? Put their address, and mention who I&apos;ll be meeting
          in the notes.
        </p>
      </Section>

      <Section tone="grey" aria-labelledby="areas-heading">
        <SectionHeading
          eyebrow="Service area"
          title="Areas I cover"
          id="areas-heading"
          lead="I come to homes and businesses right across Auckland, including:"
        />
        <div className="grid gap-x-5 lg:grid-cols-5">
          {suburbGroups.map((group) => {
            const count = group.suburbs.length;
            return (
              <details
                key={group.region ?? "other"}
                className="group border-t border-seasalt-200 py-2.5 last:border-b lg:border-t-[3px] lg:border-moonstone-500 lg:last:border-b-0"
              >
                <summary className="flex cursor-pointer list-none items-start justify-between gap-2 rounded py-1 font-extrabold text-russian-violet focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-russian-violet [&::-webkit-details-marker]:hidden">
                  <span>
                    {group.region ?? "Other areas"}
                    <small className="block text-sm font-semibold text-seasalt-700">
                      {count} {count === 1 ? "suburb" : "suburbs"}
                    </small>
                  </span>
                  <span aria-hidden="true" className="text-2xl leading-none text-moonstone-700">
                    <span className="group-open:hidden">+</span>
                    <span className="hidden group-open:inline">&minus;</span>
                  </span>
                </summary>
                <p className="mt-2 text-base text-seasalt-700">{group.suburbs.join(", ")}</p>
              </details>
            );
          })}
        </div>
        <p className="mt-5">
          These are just some of them - I cover all of Auckland. If your suburb isn&apos;t listed,
          I&apos;m still more than happy to help!
        </p>
      </Section>

      <ClosingCta
        title="Ready to get started?"
        line="Book online, or call or text and I'll help you figure out what you need."
        phone={identity.phone}
        phoneTel={identity.phoneTel}
      />
    </PageShell>
  );
}
