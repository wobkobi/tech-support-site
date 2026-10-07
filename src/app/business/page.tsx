// src/app/business/page.tsx
// Business page: ad-hoc IT support and monthly retainers for Auckland small businesses.
// Reads the live business rate from the rate config; retainer tiers are page copy
// (nothing downstream derives from them).

import { BusinessEnquiryForm } from "@/features/business/components/BusinessEnquiryForm";
import { formatMoneyCompact } from "@/features/business/lib/business";
import { getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import { Button } from "@/shared/components/Button";
import { ClosingCta } from "@/shared/components/ClosingCta";
import { PageHead } from "@/shared/components/PageHead";
import { PageShell } from "@/shared/components/PageLayout";
import { PixelEvent } from "@/shared/components/PixelEvent";
import { RuledBlock, RuledGrid } from "@/shared/components/RuledGrid";
import { Section, SectionHeading, TEXT_LINK } from "@/shared/components/Section";
import { TickItem, TickList } from "@/shared/components/TickList";
import { getIdentity } from "@/shared/lib/business-identity.server";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Metadata } from "next";
import type React from "react";
import { FaCaretDown, FaPhone } from "react-icons/fa6";

// ISR so rate edits propagate via the rate-config tag purge instead of
// requiring a redeploy.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Small Business IT Support in Auckland",
  description:
    "On-call IT support for Auckland small businesses: workstations, email, networks, backups and staff devices. Ad-hoc callouts or a monthly retainer, no lock-in.",
  alternates: { canonical: "/business" },
  openGraph: {
    title: "Business IT Support - To the Point Tech",
    description:
      "Your on-call IT person, without hiring one. Ad-hoc help and monthly retainers for Auckland small businesses.",
    url: "/business",
  },
};

interface BusinessService {
  label: string;
  examples: string[];
}

const businessServices: ReadonlyArray<BusinessService> = [
  {
    label: "Workstations & Email",
    examples: ["New PC and laptop setup", "Email and Microsoft 365", "Shared files and printers"],
  },
  {
    label: "Network & Wi-Fi",
    examples: ["Fixing dropouts", "Coverage through the office", "Router and switch setup"],
  },
  {
    label: "Backups & Security",
    examples: ["Backup checks and setup", "Password managers", "Basic security reviews"],
  },
  {
    label: "Staff On/Offboarding",
    examples: ["New staff device setup", "Account creation", "Departing-staff lockdown"],
  },
  {
    label: "Printers & Peripherals",
    examples: ["Network printing", "Scanners and EFTPOS-adjacent kit", "Driver issues"],
  },
  {
    label: "Office Moves & Projects",
    examples: ["Packing up and reconnecting IT", "Cable tidying", "One-off projects"],
  },
];

interface RetainerTier {
  name: string;
  fromPrice: string;
  tagline: string;
  inclusions: string[];
}

// Marketing copy only - retainers are quoted per client and invoiced manually
// through the normal invoice flow; no value below feeds billing.
const retainerTiers: ReadonlyArray<RetainerTier> = [
  {
    name: "Essentials",
    fromPrice: "from $99/month",
    tagline: "A safety net for the smallest teams.",
    inclusions: [
      "Priority response when something breaks",
      "Monthly check-in on backups and updates",
      "Discounted callout rate",
    ],
  },
  {
    name: "Standard",
    fromPrice: "from $249/month",
    tagline: "Ongoing cover for offices that lean on their IT.",
    inclusions: [
      "Everything in Essentials",
      "Around 2 hours of remote support included",
      "Backup and security checks each month",
    ],
  },
  {
    name: "Custom",
    fromPrice: "by quote",
    tagline: "More staff, more devices, or specific needs.",
    inclusions: [
      "Scoped to your setup and headcount",
      "On-site hours included if you want them",
      "Reviewed together as you grow",
    ],
  },
];

const howItWorks: ReadonlyArray<{ step: string; title: string; body: string }> = [
  {
    step: "1",
    title: "Get in touch",
    body: "Send an enquiry or ring. Tell me what's bugging you - or what you keep putting off.",
  },
  {
    step: "2",
    title: "Quick scoping chat",
    body: "A short call or site visit to see your setup. No charge, no obligation.",
  },
  {
    step: "3",
    title: "Start how you like",
    body: "Book ad-hoc jobs as they come up, or go on a retainer for ongoing cover. No lock-in either way.",
  },
];

const businessFaq: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: "How fast can you respond?",
    a: "Urgent business issues get same-day or next-day attention where the schedule allows. Retainer clients get priority when things are busy.",
  },
  {
    q: "Remote or on-site?",
    a: "Both. Plenty of business problems are fixed over a screen-share; anything physical - networks, printers, new hardware - gets a visit.",
  },
  {
    q: "Retainer or ad-hoc - which suits us?",
    a: "Start ad-hoc. If you find yourself calling regularly, a retainer usually works out cheaper and gets you priority response. There's no lock-in, so switching is easy.",
  },
  {
    q: "How does billing work?",
    a: "You get an itemised invoice after each job, or one monthly invoice on a retainer. No surprises - anything beyond the agreed scope is discussed before it's done.",
  },
];

// Accordion row and summary classes. Keep in step with the FAQ page rows.
const FAQ_ROW = "group border-b border-seasalt-100 first:border-t";
const FAQ_SUMMARY =
  "flex cursor-pointer list-none items-start justify-between gap-4 rounded py-4 text-lg font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-russian-violet [&::-webkit-details-marker]:hidden";

const siteUrl = getSiteUrl();

/**
 * Business page component.
 * @returns Business page element.
 */
export default async function BusinessPage(): Promise<React.ReactElement> {
  const [pricing, identity] = await Promise.all([getPublicPricing(), getIdentity()]);
  // Deliberately undiscounted. Promos are a home offer, and the calculator
  // charges a business visit's travel in full, so discounting it here would
  // quote a rate the invoice does not honour.
  const displayTravelRate = pricing.travelRatePerHour;
  const businessJsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: "Small business IT support",
    serviceType: "IT support",
    description:
      "Ad-hoc IT support and monthly retainers for small businesses in Auckland: workstation and email setup, networks, backups, staff device onboarding and office moves.",
    areaServed: { "@type": "AdministrativeArea", name: "Auckland, New Zealand" },
    provider: { "@id": `${siteUrl}#business` },
    offers: {
      "@type": "Offer",
      priceCurrency: "NZD",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: pricing.businessRate,
        priceCurrency: "NZD",
        unitCode: "HUR",
      },
      availability: "https://schema.org/InStock",
    },
  };

  return (
    <PageShell>
      <PixelEvent event="ViewContent" />
      <script
        id="ld-business"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(businessJsonLd) }}
      />
      <PageHead
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Business", path: "/business" },
        ]}
        title="IT support for Auckland small businesses"
        intro="Your on-call IT person, without hiring one. I handle the tech jobs you keep putting off - setups, migrations, network gremlins, new staff devices - so you can get back to running the business."
        note="Call me out when you need help, or set up a monthly retainer for ongoing cover. No lock-in either way."
        action={
          <div className="flex flex-wrap gap-3">
            <Button href="#enquire" variant="primary">
              Send an enquiry
            </Button>
            <Button href={identity.phoneTel} variant="outline">
              <FaPhone className="h-4 w-4" aria-hidden />
              {identity.phone}
            </Button>
          </div>
        }
      />

      {/* Ad-hoc services */}
      <Section aria-labelledby="adhoc-heading">
        <SectionHeading
          id="adhoc-heading"
          title="The stuff you don't want to do"
          lead="One-off jobs, sorted properly and explained in plain English:"
        />
        <RuledGrid cols={3}>
          {businessServices.map((area) => (
            <RuledBlock key={area.label} title={area.label}>
              <TickList className="gap-1.5">
                {area.examples.map((example) => (
                  <TickItem key={example} variant="dot">
                    {example}
                  </TickItem>
                ))}
              </TickList>
            </RuledBlock>
          ))}
        </RuledGrid>
      </Section>

      {/* Rates */}
      <Section tone="grey" aria-labelledby="rates-heading">
        <SectionHeading id="rates-heading" title="Business rates" />
        <p className="mb-4">
          Business work bills at <span className="font-bold">${pricing.businessRate}/hr</span>, on
          site or remote. You only pay for the time the job takes.
        </p>
        <TickList>
          <TickItem>
            Travel billed at {formatMoneyCompact(displayTravelRate)}/hr for one round trip per visit
          </TickItem>
          <TickItem>Quick phone questions are usually free</TickItem>
          <TickItem>Itemised invoice after every job</TickItem>
        </TickList>
      </Section>

      {/* Retainers */}
      <Section aria-labelledby="retainers-heading">
        <SectionHeading
          id="retainers-heading"
          title="Monthly retainers"
          lead="Prefer someone already across your setup? A retainer makes me your IT person on an ongoing basis. No lock-in, cancel any time, billed by invoice each month."
        />
        <RuledGrid cols={3}>
          {retainerTiers.map((tier) => (
            <RuledBlock key={tier.name} title={tier.name} className="flex flex-col">
              <p className="mb-1 text-2xl font-extrabold">{tier.fromPrice}</p>
              <p className="mb-3 text-seasalt-700">{tier.tagline}</p>
              <TickList className="flex-1 content-start">
                {tier.inclusions.map((inc) => (
                  <TickItem key={inc}>{inc}</TickItem>
                ))}
              </TickList>
              <Button href="#enquire" variant="outline" fullWidth className="mt-5">
                Ask about {tier.name}
              </Button>
            </RuledBlock>
          ))}
        </RuledGrid>
      </Section>

      {/* How it works: the page's one violet band */}
      <Section tone="violet" aria-labelledby="how-heading">
        <SectionHeading onDark id="how-heading" title="How it works" />
        <RuledGrid cols={3}>
          {howItWorks.map((item, i) => (
            <RuledBlock key={item.step} title={`${i + 1}. ${item.title}`}>
              <p className="text-russian-violet-100">{item.body}</p>
            </RuledBlock>
          ))}
        </RuledGrid>
      </Section>

      {/* Business FAQ */}
      <Section tone="grey" aria-labelledby="bfaq-heading">
        <SectionHeading id="bfaq-heading" title="Common questions" />
        <div className="max-w-180">
          {businessFaq.map((item) => (
            <details key={item.q} className={FAQ_ROW}>
              <summary className={FAQ_SUMMARY}>
                <h3 className="text-lg font-bold">{item.q}</h3>
                <FaCaretDown
                  className="mt-1.5 h-4 w-4 shrink-0 text-moonstone-700 transition-[rotate] group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="pb-4 text-seasalt-700">{item.a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* Enquiry */}
      <Section id="enquire" aria-labelledby="enquire-heading">
        <SectionHeading
          id="enquire-heading"
          title="Tell me what you need"
          lead="A couple of sentences is plenty - I'll come back to you within one business day."
        />
        <div className="max-w-180 rounded-lg bg-seasalt p-7">
          <BusinessEnquiryForm />
        </div>
        <p className="mt-6">
          Prefer to talk? Ring{" "}
          <a href={identity.phoneTel} className={TEXT_LINK}>
            {identity.phone}
          </a>{" "}
          or email{" "}
          <a href={`mailto:${identity.email}`} className={TEXT_LINK}>
            {identity.email}
          </a>
          .
        </p>
      </Section>

      <ClosingCta
        title="Rather talk it through?"
        line="Ring or text me, or book a visit online."
        phone={identity.phone}
        phoneTel={identity.phoneTel}
      />
    </PageShell>
  );
}
