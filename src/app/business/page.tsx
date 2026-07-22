// src/app/business/page.tsx
/**
 * @description Business page: ad-hoc IT support and monthly retainers for
 * Auckland small businesses. Reads the live business rate from the rate
 * config; retainer tiers are page copy (nothing downstream derives from them).
 */

import { BusinessEnquiryForm } from "@/features/business/components/BusinessEnquiryForm";
import { getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import { BreadcrumbJsonLd } from "@/shared/components/BreadcrumbJsonLd";
import { Button } from "@/shared/components/Button";
import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { PixelEvent } from "@/shared/components/PixelEvent";
import { cn } from "@/shared/lib/cn";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Metadata } from "next";
import type React from "react";
import {
  FaLaptop,
  FaPhone,
  FaPrint,
  FaShieldHalved,
  FaTruck,
  FaUserPlus,
  FaWifi,
} from "react-icons/fa6";

// ISR so rate edits propagate via the rate-config tag purge instead of
// requiring a redeploy.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Business IT Support - Ad-hoc Help & Monthly Retainers in Auckland",
  description:
    "On-call IT support for Auckland small businesses: workstation and email setup, network fixes, backups, staff device onboarding and office moves. Ad-hoc callouts or a simple monthly retainer - no lock-in.",
  alternates: { canonical: "/business" },
  openGraph: {
    title: "Business IT Support - To The Point Tech",
    description:
      "Your on-call IT person, without hiring one. Ad-hoc help and monthly retainers for Auckland small businesses.",
    url: "/business",
  },
};

interface BusinessService {
  icon: React.ReactElement;
  label: string;
  examples: string[];
}

const businessServices: ReadonlyArray<BusinessService> = [
  {
    icon: <FaLaptop />,
    label: "Workstations & Email",
    examples: ["New PC and laptop setup", "Email and Microsoft 365", "Shared files and printers"],
  },
  {
    icon: <FaWifi />,
    label: "Network & Wi-Fi",
    examples: ["Fixing dropouts", "Coverage through the office", "Router and switch setup"],
  },
  {
    icon: <FaShieldHalved />,
    label: "Backups & Security",
    examples: ["Backup checks and setup", "Password managers", "Basic security reviews"],
  },
  {
    icon: <FaUserPlus />,
    label: "Staff On/Offboarding",
    examples: ["New staff device setup", "Account creation", "Departing-staff lockdown"],
  },
  {
    icon: <FaPrint />,
    label: "Printers & Peripherals",
    examples: ["Network printing", "Scanners and EFTPOS-adjacent kit", "Driver issues"],
  },
  {
    icon: <FaTruck />,
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

const siteUrl = getSiteUrl();

/**
 * Business page component.
 * @returns Business page element.
 */
export default async function BusinessPage(): Promise<React.ReactElement> {
  const pricing = await getPublicPricing();
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
      <BreadcrumbJsonLd
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Business", path: "/business" },
        ]}
      />
      <FrostedSection>
        <div className="flex flex-col gap-6 sm:gap-8">
          {/* Hero */}
          <section
            aria-labelledby="business-heading"
            className={cn(CARD, "animate-fade-in text-center")}
          >
            <h1
              id="business-heading"
              className="mb-4 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl"
            >
              IT support for Auckland small businesses
            </h1>

            <p className="mx-auto mb-4 max-w-2xl text-base text-rich-black sm:text-lg">
              Your on-call IT person, without hiring one. I handle the tech jobs you keep putting
              off - setups, migrations, network gremlins, new staff devices - so you can get back to
              running the business.
            </p>

            <p className="mx-auto mb-8 max-w-2xl text-base text-rich-black/80 sm:text-lg">
              Call me out when you need help, or set up a monthly retainer for ongoing cover. No
              lock-in either way.
            </p>

            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Button href="#enquire" variant="primary" size="lg" className="w-full sm:w-auto">
                Send an enquiry
              </Button>
              <Button
                href="tel:+64212971237"
                variant="secondary"
                size="lg"
                className="w-full sm:w-auto"
              >
                <FaPhone className="h-6 w-6" aria-hidden />
                021 297 1237
              </Button>
            </div>
          </section>

          {/* Ad-hoc services */}
          <section
            aria-labelledby="adhoc-heading"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}
          >
            <h2
              id="adhoc-heading"
              className="mb-3 text-xl font-bold text-russian-violet sm:text-2xl"
            >
              The stuff you don't want to do
            </h2>

            <p className="mb-4 text-base text-rich-black sm:text-lg">
              One-off jobs, sorted properly and explained in plain English:
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {businessServices.map((area) => (
                <div
                  key={area.label}
                  className="rounded-lg border border-seasalt-400/60 bg-seasalt-800 p-3 shadow-sm transition-all hover:shadow-md"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-moonstone-500/40 bg-moonstone-600/20">
                      <span className="text-2xl text-moonstone-600" aria-hidden>
                        {area.icon}
                      </span>
                    </span>
                    <h3 className="text-lg font-semibold text-rich-black sm:text-xl">
                      {area.label}
                    </h3>
                  </div>
                  <ul className="space-y-1 text-base text-rich-black/80 sm:text-lg">
                    {area.examples.map((example) => (
                      <li key={example} className="flex gap-2">
                        <span className="mt-0.5 text-moonstone-600">•</span>
                        <span>{example}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {/* Rates */}
          <section
            aria-labelledby="rates-heading"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-200")}
          >
            <h2
              id="rates-heading"
              className="mb-3 text-xl font-bold text-russian-violet sm:text-2xl"
            >
              Business rates
            </h2>

            <p className="mb-3 text-base text-rich-black sm:text-lg">
              Business work bills at{" "}
              <span className="font-bold text-russian-violet">${pricing.businessRate}/hr</span>, on
              site or remote. You only pay for the time the job takes.
            </p>

            <ul className="space-y-2 text-base text-rich-black/90 sm:text-lg">
              <li className="flex gap-2">
                <span className="mt-1 text-moonstone-600">•</span>
                <span>
                  Travel billed at ${pricing.travelRatePerHour}/hr for one round trip per visit
                </span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1 text-moonstone-600">•</span>
                <span>Quick phone questions are usually free</span>
              </li>
              <li className="flex gap-2">
                <span className="mt-1 text-moonstone-600">•</span>
                <span>Itemised invoice after every job</span>
              </li>
            </ul>
          </section>

          {/* Retainers */}
          <section
            aria-labelledby="retainers-heading"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-300")}
          >
            <h2
              id="retainers-heading"
              className="mb-3 text-xl font-bold text-russian-violet sm:text-2xl"
            >
              Monthly retainers
            </h2>

            <p className="mb-4 text-base text-rich-black sm:text-lg">
              Prefer someone already across your setup? A retainer makes me your IT person on an
              ongoing basis. No lock-in, cancel any time, billed by invoice each month.
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {retainerTiers.map((tier) => (
                <div
                  key={tier.name}
                  className="flex flex-col rounded-lg border border-seasalt-400/60 bg-seasalt-800 p-4 shadow-sm transition-all hover:shadow-md"
                >
                  <h3 className="text-lg font-semibold text-rich-black sm:text-xl">{tier.name}</h3>
                  <p className="mb-1 text-lg font-bold text-russian-violet sm:text-xl">
                    {tier.fromPrice}
                  </p>
                  <p className="mb-3 text-base text-rich-black/70">{tier.tagline}</p>
                  <ul className="mb-4 flex-1 space-y-1 text-base text-rich-black/80 sm:text-lg">
                    {tier.inclusions.map((inc) => (
                      <li key={inc} className="flex gap-2">
                        <span className="mt-0.5 text-moonstone-600">•</span>
                        <span>{inc}</span>
                      </li>
                    ))}
                  </ul>
                  <Button href="#enquire" variant="tertiary" size="md" fullWidth>
                    Ask about {tier.name}
                  </Button>
                </div>
              ))}
            </div>
          </section>

          {/* How it works */}
          <section
            aria-labelledby="how-heading"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-400")}
          >
            <h2 id="how-heading" className="mb-4 text-xl font-bold text-russian-violet sm:text-2xl">
              How it works
            </h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {howItWorks.map((item) => (
                <div key={item.step} className="flex gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full border border-moonstone-500/40 bg-moonstone-600/20 text-lg font-bold text-moonstone-600">
                    {item.step}
                  </span>
                  <div>
                    <h3 className="mb-1 text-lg font-semibold text-rich-black sm:text-xl">
                      {item.title}
                    </h3>
                    <p className="text-base text-rich-black/80 sm:text-lg">{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Business FAQ */}
          <section
            aria-labelledby="bfaq-heading"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-500")}
          >
            <h2
              id="bfaq-heading"
              className="mb-4 text-xl font-bold text-russian-violet sm:text-2xl"
            >
              Common questions
            </h2>

            <div className="space-y-4">
              {businessFaq.map((item) => (
                <div key={item.q}>
                  <h3 className="mb-1 text-lg font-semibold text-rich-black sm:text-xl">
                    {item.q}
                  </h3>
                  <p className="text-base text-rich-black/80 sm:text-lg">{item.a}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Enquiry */}
          <section
            id="enquire"
            aria-labelledby="enquire-heading"
            className={cn(
              CARD,
              "animate-slide-up animate-fill-both animate-delay-500 scroll-mt-24",
            )}
          >
            <h2
              id="enquire-heading"
              className="mb-3 text-xl font-bold text-russian-violet sm:text-2xl"
            >
              Tell me what you need
            </h2>

            <p className="mb-4 text-base text-rich-black sm:text-lg">
              A couple of sentences is plenty - I'll come back to you within one business day.
            </p>

            <BusinessEnquiryForm />

            <p className="mt-6 text-base text-rich-black/80 sm:text-lg">
              Prefer to talk? Ring{" "}
              <a
                href="tel:+64212971237"
                className="font-semibold text-russian-violet underline underline-offset-2 hover:text-russian-violet/80"
              >
                021 297 1237
              </a>{" "}
              or email{" "}
              <a
                href="mailto:harrison@tothepoint.co.nz"
                className="font-semibold text-russian-violet underline underline-offset-2 hover:text-russian-violet/80"
              >
                harrison@tothepoint.co.nz
              </a>
              .
            </p>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
