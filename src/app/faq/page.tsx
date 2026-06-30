// src/app/faq/page.tsx
/**
 * @description FAQ page: common questions about services, pricing, and ways of working.
 * Server-rendered with live rates from the RateConfig table so the headline
 * prices stay in sync with whatever the operator has set, and cancellation /
 * unsuccessful-work / GST copy comes from pricing-policy.ts so this page
 * never drifts from the /pricing accordion + booking emails.
 */

import {
  cancellationCopy,
  gstCopy,
  unsuccessfulWorkCopy,
} from "@/features/business/lib/pricing-policy";
import { getPolicy, getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import { BreadcrumbJsonLd } from "@/shared/components/BreadcrumbJsonLd";
import { CARD, FrostedSection, PageShell, SOFT_CARD } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";

export const metadata: Metadata = {
  title: "FAQ - Tech Support Questions Answered",
  description:
    "Common questions about tech support in Auckland: service areas, remote support, pricing, devices supported, booking, cancellations and what happens if I can't fix it.",
  alternates: { canonical: "/faq" },
  openGraph: {
    title: "FAQ - To The Point Tech",
    description: "Common questions about tech support, service areas, pricing and remote help.",
    url: "/faq",
  },
};

// Live rates and copy are dynamic per request; ISR would serve stale prices.
export const dynamic = "force-dynamic";

interface FaqItem {
  question: string;
  answer: React.ReactNode;
  /** Plain-text answer for FAQPage JSON-LD (search engines need text, not React nodes). */
  plainAnswer: string;
}

const linkStyle =
  "text-coquelicot-500 hover:text-coquelicot-600 underline-offset-4 hover:underline";

/**
 * Strips `**…**` markers for JSON-LD plain-text contexts.
 * @param text - Copy string with `**…**` segments.
 * @returns Plain-text equivalent.
 */
function stripEmphasis(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}

/**
 * Renders `**…**` as `<strong>` spans for the JSX accordion bodies.
 * @param text - Copy string containing zero or more `**…**` segments.
 * @returns Array of React nodes ready to drop into a parent block element.
 */
function renderEmphasised(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const m = part.match(/^\*\*([^*]+)\*\*$/);
    return m ? <strong key={i}>{m[1]}</strong> : <span key={i}>{part}</span>;
  });
}

/**
 * FAQ page component.
 * @returns FAQ page element.
 */
export default async function FaqPage(): Promise<React.ReactElement> {
  const [pricing, policy] = await Promise.all([getPublicPricing(), getPolicy()]);
  const cancellationText = cancellationCopy(policy.CANCELLATION);
  const unsuccessfulText = unsuccessfulWorkCopy();
  const gstText = gstCopy(policy.GST_REGISTERED);

  const faqItems: ReadonlyArray<FaqItem> = [
    {
      question: "What areas of Auckland do you cover?",
      plainAnswer:
        "I work across the wider Auckland area, from Central out to the Inner West, North Shore, East and South. For most addresses I can come to you. Not sure if you're in range? Send a message with your suburb and I'll confirm.",
      answer: (
        <>
          <p>
            I work across the wider Auckland area - Central, North Shore, East, South, and out West.
            For most addresses around the city I can come to you.
          </p>
          <p className="mt-2 text-rich-black/80">
            Not quite sure if you're in range? Drop me a message with your suburb and I'll let you
            know.
          </p>
        </>
      ),
    },
    {
      question: "Do you offer remote support?",
      plainAnswer:
        "Yes. A lot of software, account, and setup issues can be sorted remotely once you've given me access. If it turns out the problem really needs hands on a Wi-Fi router, printer, or cable, we can swap to an on-site visit instead.",
      answer: (
        <>
          <p>
            Yes - a lot of software, account, and setup work can be done remotely once you've given
            me access, which usually means a faster turnaround and a lower bill.
          </p>
          <p className="mt-2 text-rich-black/80">
            If it turns out the issue really needs hands on a router, printer, or cable, we can
            switch to an on-site visit instead.
          </p>
        </>
      ),
    },
    {
      question: "What devices and systems do you work with?",
      plainAnswer:
        "Pretty much anything you'd find in a home or small office: Windows and Mac computers, iPhones and Android phones, iPads and tablets, printers, smart TVs, routers and mesh Wi-Fi, smart home gear, and more. If you have something unusual, mention the model and I'll let you know whether I can help.",
      answer: (
        <>
          <p>
            Pretty much anything you'd find in a home or small office - Windows and Mac computers,
            iPhones and Android phones, iPads and tablets, printers, smart TVs, routers, mesh Wi-Fi,
            and smart home gear. After a few years of doing this I can usually pick up something new
            quickly.
          </p>
          <p className="mt-2 text-rich-black/80">
            If you have something unusual or specialised, just tell me the make and model up front
            and I'll let you know whether I can help or point you to the right person.
          </p>
        </>
      ),
    },
    {
      question: "How much does it cost?",
      plainAnswer: `Work is $${pricing.baseRate}/hr whatever the job - troubleshooting, setup, data recovery, hardware repairs, the lot. On-site visits also include round-trip drive time at $${pricing.travelRatePerHour}/hr ($10 minimum). I'll always confirm the expected cost before any work starts so there are no surprises on the bill.`,
      answer: (
        <>
          <p>
            Work is <strong>${pricing.baseRate}/hr</strong> whatever the job - troubleshooting,
            setup, data recovery, hardware repairs, the lot. I confirm the expected cost before any
            work starts, so there are no surprises on the invoice.
          </p>
          <p className="mt-2 text-rich-black/80">
            On-site visits also include one round trip billed at{" "}
            <strong>${pricing.travelRatePerHour}/hr</strong> (the dedicated Travel rate, lower than
            labour), with a $10 minimum when there's any travel at all.
          </p>
          <p className="mt-2 text-rich-black/80">
            The full breakdown lives on the{" "}
            <Link href="/pricing" className={linkStyle}>
              pricing page
            </Link>
            , or you can{" "}
            <Link href="/contact" className={linkStyle}>
              get in touch
            </Link>{" "}
            for a quote on a specific job.
          </p>
        </>
      ),
    },
    {
      question: "Do you sell hardware or push unnecessary upgrades?",
      plainAnswer:
        "No. I don't resell hardware and I don't earn commission on anything, so there's no incentive to nudge you towards extras you don't need. The aim is to leave the existing setup working properly. If a replacement part or upgrade genuinely makes sense, I'll lay out the options and the trade-offs and let you decide. If you're not sure what to buy - whether it's a part, a cable, a new device, or any other piece of tech - I can suggest the right thing to get, or pick one up and bring it along, so you don't end up with the wrong product.",
      answer: (
        <>
          <p>
            No - I don't resell hardware and don't earn commission on anything, so there's no
            incentive to push extras. The aim is to get the gear you already have working properly.
          </p>
          <p className="mt-2 text-rich-black/80">
            If a replacement part or an upgrade genuinely makes sense, I'll lay out the options and
            trade-offs and you decide whether it's worth doing.
          </p>
          <p className="mt-2 text-rich-black/80">
            If you're not sure what to buy - whether it's a part, cable, new device, or any other
            piece of tech - I can suggest the right thing to get, or pick it up and bring it along
            so you don't end up with the wrong product.
          </p>
        </>
      ),
    },
    {
      question: "How do I book an appointment?",
      plainAnswer:
        "The fastest way is to book online via the booking page - it shows available days and times. You can also call or email if you'd rather chat first. For anything urgent, a phone call works best because I can usually slot you in sooner.",
      answer: (
        <>
          <p>
            The fastest way is to{" "}
            <Link href="/booking" className={linkStyle}>
              book online
            </Link>{" "}
            - it shows the available days and times. You can also{" "}
            <Link href="/contact" className={linkStyle}>
              contact me
            </Link>{" "}
            by phone or email if you'd rather chat through it first.
          </p>
          <p className="mt-2 text-rich-black/80">
            For anything urgent, a phone call works best - I can usually slot you in sooner that
            way.
          </p>
        </>
      ),
    },
    {
      question: "How do I cancel or reschedule?",
      plainAnswer: `Every booking confirmation email has cancel and reschedule links. Use those, or just reply to the email and I'll sort it. ${stripEmphasis(cancellationText)}`,
      answer: (
        <>
          <p>
            Every booking confirmation email has cancel and reschedule links. Use those, or just
            reply to the email and I'll sort it out.
          </p>
          <p className="mt-2 text-rich-black/80">{renderEmphasised(cancellationText)}</p>
        </>
      ),
    },
    {
      question: "What if I cancel last-minute?",
      plainAnswer: stripEmphasis(cancellationText),
      answer: (
        <>
          <p>{renderEmphasised(cancellationText)}</p>
          <p className="mt-2 text-rich-black/80">
            The cancel page itself shows you which window you're in (free / $30 callout / $30 +
            travel) before you confirm, so there's no surprise.
          </p>
        </>
      ),
    },
    {
      question: "What happens if I miss my appointment?",
      plainAnswer:
        "No-shows are billed as late cancellations - the call-out fee plus the round-trip travel I would have made to your address. If you realise you can't make it, let me know any time before the appointment to avoid the travel charge; if you give 12+ hours notice there's no fee at all.",
      answer: (
        <>
          <p>
            No-shows are billed as late cancellations - the call-out fee plus the round-trip travel
            I would have made to your address.
          </p>
          <p className="mt-2 text-rich-black/80">
            If you realise you can't make it, let me know any time before the appointment to skip
            the travel charge; with 12+ hours notice there's no fee at all.
          </p>
        </>
      ),
    },
    {
      question: "What if you can't fix the problem?",
      plainAnswer: stripEmphasis(unsuccessfulText),
      answer: (
        <>
          <p className="whitespace-pre-line">{renderEmphasised(unsuccessfulText)}</p>
        </>
      ),
    },
    {
      question: "Do I pay GST?",
      plainAnswer: stripEmphasis(gstText),
      answer: <p>{renderEmphasised(gstText)}</p>,
    },
  ];

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqItems.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.plainAnswer,
      },
    })),
  };

  return (
    <PageShell>
      <script
        id="ld-faq"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <BreadcrumbJsonLd
        crumbs={[
          { name: "Home", path: "/" },
          { name: "FAQ", path: "/faq" },
        ]}
      />
      <FrostedSection>
        <div className="flex flex-col gap-6 sm:gap-8">
          <section aria-labelledby="faq-heading" className={cn(CARD, "animate-fade-in")}>
            <h1
              id="faq-heading"
              className="mb-4 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl"
            >
              Frequently asked questions
            </h1>
            <p className="text-base text-rich-black/80 sm:text-lg">
              Quick answers to common questions. Don't see yours?{" "}
              <Link href="/contact" className={linkStyle}>
                Get in touch
              </Link>
              .
            </p>
          </section>

          <section
            aria-label="FAQ list"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {[faqItems.filter((_, i) => i % 2 === 0), faqItems.filter((_, i) => i % 2 !== 0)].map(
                (col, colIdx) => (
                  <div key={colIdx} className="flex flex-1 flex-col gap-4">
                    {col.map((item) => (
                      <details key={item.question} className={cn(SOFT_CARD, "group")}>
                        <summary
                          className={cn(
                            "flex cursor-pointer items-center justify-between gap-3 text-base font-semibold text-rich-black select-text sm:text-lg",
                            "list-none [&::-webkit-details-marker]:hidden",
                          )}
                        >
                          <span>{item.question}</span>
                          <span
                            className="shrink-0 text-lg text-moonstone-600 transition-transform duration-200 group-open:rotate-180"
                            aria-hidden
                          >
                            ▾
                          </span>
                        </summary>
                        <div className="mt-3 text-base text-rich-black/90 sm:text-lg">
                          {item.answer}
                        </div>
                      </details>
                    ))}
                  </div>
                ),
              )}
            </div>
          </section>

          <section
            aria-label="Next steps"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-200")}
          >
            <p className="text-base text-rich-black sm:text-lg">
              Ready to get started?{" "}
              <Link href="/booking" className={linkStyle}>
                Book online
              </Link>{" "}
              or{" "}
              <Link href="/contact" className={linkStyle}>
                contact me
              </Link>{" "}
              to discuss your needs.
            </p>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
