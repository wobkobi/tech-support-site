// src/app/faq/page.tsx
/**
 * @file page.tsx
 * @description FAQ page: common questions about services, pricing, and how I work.
 */

import type { Metadata } from "next";
import type React from "react";
import Link from "next/link";
import Script from "next/script";
import { FrostedSection, PageShell, CARD, SOFT_CARD } from "@/shared/components/PageLayout";
import { BreadcrumbJsonLd } from "@/shared/components/BreadcrumbJsonLd";
import { cn } from "@/shared/lib/cn";

export const metadata: Metadata = {
  title: "FAQ - Tech Support Questions Answered",
  description:
    "Common questions about tech support in Auckland: service areas, remote support, pricing ($65/h), devices supported, booking and what happens if I can't fix it.",
  keywords: [
    "tech support FAQ Auckland",
    "computer help questions",
    "IT support pricing questions",
    "remote support FAQ",
  ],
  alternates: { canonical: "/faq" },
  openGraph: {
    title: "FAQ - To The Point Tech",
    description: "Common questions about tech support, service areas, pricing and remote help.",
    url: "/faq",
  },
};

interface FaqItem {
  question: string;
  answer: React.ReactNode;
  /** Plain-text answer for FAQPage JSON-LD (search engines need text, not React nodes). */
  plainAnswer: string;
}

const linkStyle = cn(
  "text-coquelicot-500 hover:text-coquelicot-600 underline-offset-4 hover:underline",
);

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
        <p className={cn("text-rich-black/80 mt-2")}>
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
          Yes - a lot of software, account, and setup work can be done remotely once you've given me
          access, which usually means a faster turnaround and a lower bill.
        </p>
        <p className={cn("text-rich-black/80 mt-2")}>
          If it turns out the issue really needs hands on a router, printer, or cable, we can switch
          to an on-site visit instead.
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
        <p className={cn("text-rich-black/80 mt-2")}>
          If you have something unusual or specialised, just tell me the make and model up front and
          I'll let you know whether I can help or point you to the right person.
        </p>
      </>
    ),
  },
  {
    question: "How much does it cost?",
    plainAnswer:
      "Most work is $65/h. Complex or lengthy jobs - things like data recovery, hardware repairs, or migrating a whole PC - are $85/h. I'll always confirm which rate applies before any work starts so there are no surprises on the bill.",
    answer: (
      <>
        <p>
          Most work is <strong>$65/h</strong>. Complex or lengthy jobs - data recovery, hardware
          repairs, or full PC migrations - are <strong>$85/h</strong>. I confirm which rate applies
          before any work starts, so there are no surprises on the invoice.
        </p>
        <p className={cn("text-rich-black/80 mt-2")}>
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
        <p className={cn("text-rich-black/80 mt-2")}>
          If a replacement part or an upgrade genuinely makes sense, I'll lay out the options and
          trade-offs and you decide whether it's worth doing.
        </p>
        <p className={cn("text-rich-black/80 mt-2")}>
          If you're not sure what to buy - whether it's a part, cable, new device, or any other
          piece of tech - I can suggest the right thing to get, or pick it up and bring it along so
          you don't end up with the wrong product.
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
        <p className={cn("text-rich-black/80 mt-2")}>
          For anything urgent, a phone call works best - I can usually slot you in sooner that way.
        </p>
      </>
    ),
  },
  {
    question: "What if you can't fix the problem?",
    plainAnswer:
      "If I can't resolve the issue, on-site visits are charged at half the usual rate. Remote sessions are normally free if nothing is fixed, though I may charge for very extended troubleshooting where a lot of time has gone into the diagnosis.",
    answer: (
      <>
        <p>
          If I genuinely can't resolve the issue, on-site visits are charged at half the usual rate
          and remote sessions are normally free.
        </p>
        <p className={cn("text-rich-black/80 mt-2")}>
          The exception is very extended remote troubleshooting where a lot of time has gone into
          the diagnosis - I'll let you know up front if a session is heading that way.
        </p>
      </>
    ),
  },
];

/**
 * FAQ page component.
 * @returns FAQ page element.
 */
export default function FaqPage(): React.ReactElement {
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
      <Script
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
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section aria-labelledby="faq-heading" className={cn(CARD, "animate-fade-in")}>
            <h1
              id="faq-heading"
              className={cn(
                "text-russian-violet mb-4 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Frequently asked questions
            </h1>
            <p className={cn("text-rich-black/80 text-base sm:text-lg")}>
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
            <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-start")}>
              {[faqItems.filter((_, i) => i % 2 === 0), faqItems.filter((_, i) => i % 2 !== 0)].map(
                (col, colIdx) => (
                  <div key={colIdx} className={cn("flex flex-1 flex-col gap-4")}>
                    {col.map((item) => (
                      <details key={item.question} className={cn(SOFT_CARD, "group")}>
                        <summary
                          className={cn(
                            "text-rich-black flex cursor-pointer select-text items-center justify-between gap-3 text-sm font-semibold sm:text-base",
                            "list-none [&::-webkit-details-marker]:hidden",
                          )}
                        >
                          <span>{item.question}</span>
                          <span
                            className={cn(
                              "text-moonstone-600 shrink-0 text-lg transition-transform duration-200 group-open:rotate-180",
                            )}
                            aria-hidden
                          >
                            ▾
                          </span>
                        </summary>
                        <div className={cn("text-rich-black/90 mt-3 text-sm sm:text-base")}>
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
            <p className={cn("text-rich-black text-base sm:text-lg")}>
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
