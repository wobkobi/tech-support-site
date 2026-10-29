// src/app/faq/page.tsx
// FAQ page. Live rates, and policy copy from pricing-policy.ts so it matches /pricing
// and the booking emails.

import { formatMoneyCompact, goldCardOffText } from "@/features/business/lib/business";
import {
  cancellationCopy,
  cancellationTiersCopy,
  gstCopy,
  noShowCopy,
  partsCopy,
  surchargeCaveat,
  unsuccessfulWorkCopy,
  workmanshipCopy,
} from "@/features/business/lib/pricing-policy";
import { getPolicy, getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import {
  getActivePromo,
  promoDisplayRate,
  promoForRateCard,
  promoTravelFactor,
} from "@/features/business/lib/promos";
import { ClosingCta } from "@/shared/components/ClosingCta";
import { Disclosure } from "@/shared/components/Disclosure";
import { PageHead } from "@/shared/components/PageHead";
import { PageShell } from "@/shared/components/PageLayout";
import { PromoPrice } from "@/shared/components/PromoPrice";
import { renderEmphasised } from "@/shared/components/renderEmphasised";
import { Section, SectionHeading, TEXT_LINK } from "@/shared/components/Section";
import { jsonLdHtml } from "@/shared/lib/json-ld";
import { roundCents } from "@/shared/lib/money";
import { pageOpenGraph } from "@/shared/lib/open-graph";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";

const TITLE = "FAQ - Tech Support Questions Answered";
const DESCRIPTION =
  "Answers on tech support in Auckland: areas covered, remote help, pricing, devices, booking, cancellations and what happens if I can't fix it.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/faq" },
  openGraph: pageOpenGraph({ title: TITLE, description: DESCRIPTION, url: "/faq" }),
};

// Rate and settings edits purge via cache tags; the daily timer is a fallback.
export const revalidate = 86400;

/** The page's question sections, in order. */
const FAQ_GROUPS = [
  { id: "visits", title: "Visits and remote help" },
  { id: "prices", title: "Prices and paying" },
  { id: "booking", title: "Booking and cancelling" },
  { id: "problems", title: "If something goes wrong" },
] as const;

interface FaqItem {
  /** Which of {@link FAQ_GROUPS} the question sits under. */
  group: (typeof FAQ_GROUPS)[number]["id"];
  question: string;
  answer: React.ReactNode;
  /** Plain-text answer for FAQPage JSON-LD (search engines need text, not React nodes). */
  plainAnswer: string;
}

const linkStyle = "text-coquelicot-700 underline underline-offset-4 hover:text-coquelicot-800";

/**
 * Strips `**…**` markers for JSON-LD plain-text contexts.
 * @param text - Copy string with `**…**` segments.
 * @returns Plain-text equivalent.
 */
function stripEmphasis(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1");
}

/**
 * FAQ page component.
 * @returns FAQ page element.
 */
export default async function FaqPage(): Promise<React.ReactElement> {
  const [pricing, policy, settings, promo] = await Promise.all([
    getPublicPricing(),
    getPolicy(),
    getSettings(),
    getActivePromo(),
  ]);
  // Quote promo prices to match the banner, except day- or spend-restricted promos,
  // which the FAQ can't check.
  const pricedPromo = promoForRateCard(promo);
  const displayRate = promoDisplayRate(pricing.baseRate, pricedPromo);
  const travelFactor = promoTravelFactor(pricedPromo);
  const displayTravelRate = roundCents(pricing.travelRatePerHour * travelFactor);
  const displayMinTravel = roundCents(policy.MIN_TRAVEL_CHARGE * travelFactor);
  const rateDiscounted = displayRate !== pricing.baseRate;
  const travelDiscounted = travelFactor < 1;
  // Flat $/hr, which no promo discounts; empty when both surcharges are off.
  const surchargeText = surchargeCaveat({
    weekendPerHour: policy.WEEKEND_PER_HOUR,
    publicHolidayPerHour: policy.PUBLIC_HOLIDAY_PER_HOUR,
    afterHoursFromHour: policy.AFTER_HOURS_FROM_HOUR,
  });
  const surchargeSentence = surchargeText ? ` ${surchargeText}` : "";
  const goldCardSentence =
    pricing.goldCardPercent !== null
      ? ` SuperGold Card holders get ${goldCardOffText(pricing.goldCardPercent)}.`
      : "";
  const paymentTermsDays = settings.identity.paymentTermsDays;
  const cancellationText = cancellationCopy(policy.CANCELLATION);
  const cancellationTiers = cancellationTiersCopy(policy.CANCELLATION);
  const noShow = noShowCopy(policy.CANCELLATION);
  const unsuccessfulText = unsuccessfulWorkCopy(
    policy.UNSUCCESSFUL_WORK_FACTOR,
    policy.NO_FIX_FREE_MINS,
  );
  const workmanshipText = workmanshipCopy(policy.WORKMANSHIP_WINDOW_DAYS);
  const partsText = partsCopy();
  const gstText = gstCopy(policy.GST_REGISTERED);

  const faqItems: ReadonlyArray<FaqItem> = [
    {
      group: "visits",
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
      group: "visits",
      question: "Do you offer remote support?",
      plainAnswer:
        "Yes. A lot of software, account, and setup issues can be sorted remotely once you've given me access, or talked through over the phone. Both bill at the cheaper remote rate with no travel. If it turns out the problem really needs hands on a Wi-Fi router, printer, or cable, we can swap to an on-site visit instead.",
      answer: (
        <>
          <p>
            Yes - a lot of software, account, and setup work can be done remotely once you've given
            me access, or talked through over the phone. Both bill at the cheaper remote rate with
            no travel, which usually means a faster turnaround and a lower bill.
          </p>
          <p className="mt-2 text-rich-black/80">
            If it turns out the issue really needs hands on a router, printer, or cable, we can
            switch to an on-site visit instead.
          </p>
        </>
      ),
    },
    {
      group: "visits",
      question: "Is remote access safe?",
      plainAnswer:
        "Yes - you stay in control the whole time. A remote session only happens at a time we've arranged: you let me in, you can watch everything I do on your screen, and you can end the session at any moment. When the session ends, so does my access - I cannot connect to your computer without you. And if anyone rings you out of the blue claiming to be tech support and asking for remote access, that's a scam: hang up. I only ever connect at a time you've booked with me.",
      answer: (
        <>
          <p>
            Yes - you stay in control the whole time. A remote session only happens at a time we've
            arranged: you let me in, you can watch everything I do on your screen, and you can end
            the session at any moment. When the session ends, so does my access -{" "}
            <strong>I cannot connect to your computer without you</strong>.
          </p>
          <p className="mt-2 text-rich-black/80">
            And a word of warning: if anyone rings you out of the blue claiming to be "tech support"
            and asking for remote access, that's a scam - hang up. I only ever connect at a time
            you've booked with me.
          </p>
        </>
      ),
    },
    {
      group: "visits",
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
      group: "prices",
      question: "How much does it cost?",
      plainAnswer: `Work is ${formatMoneyCompact(displayRate)}/hr whatever the job - troubleshooting, setup, data recovery, hardware repairs, the lot.${surchargeSentence}${goldCardSentence} On-site visits also include round-trip drive time at ${formatMoneyCompact(displayTravelRate)}/hr (${formatMoneyCompact(displayMinTravel)} minimum). I'll always confirm the expected cost before any work starts so there are no surprises on the bill.`,
      answer: (
        <>
          <p>
            Work is{" "}
            <PromoPrice discounted={rateDiscounted} className="font-bold">
              {formatMoneyCompact(displayRate)}/hr
            </PromoPrice>{" "}
            whatever the job - troubleshooting, setup, data recovery, hardware repairs, the lot.
            {surchargeSentence}
            {goldCardSentence} I confirm the expected cost before any work starts, so there are no
            surprises on the invoice.
          </p>
          <p className="mt-2 text-rich-black/80">
            On-site visits also include one round trip billed at{" "}
            <PromoPrice discounted={travelDiscounted} className="font-bold">
              {formatMoneyCompact(displayTravelRate)}/hr
            </PromoPrice>{" "}
            (the dedicated Travel rate, lower than labour), with a{" "}
            <PromoPrice discounted={travelDiscounted}>
              {formatMoneyCompact(displayMinTravel)}
            </PromoPrice>{" "}
            minimum when there's any travel at all.
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
      group: "prices",
      question: "What if the job takes longer than the estimate?",
      plainAnswer:
        "You'll never be surprised by the bill. I confirm the expected cost before starting, and if the work is heading past it, I pause and check with you before carrying on - you decide whether to continue. A booked time slot isn't a hard cutoff either: if the job needs longer and the calendar allows, I stay until it's sorted. And if it genuinely needs a second visit, the extra trip's travel is on me.",
      answer: (
        <>
          <p>
            You'll never be surprised by the bill. I confirm the expected cost before starting, and
            if the work is heading past it, <strong>I pause and check with you</strong> before
            carrying on - you decide whether to continue.
          </p>
          <p className="mt-2 text-rich-black/80">
            A booked time slot isn't a hard cutoff either: if the job needs longer and the calendar
            allows, I stay until it's sorted. And if it genuinely needs a second visit, the extra
            trip's travel is on me.
          </p>
        </>
      ),
    },
    {
      group: "prices",
      question: "Do you sell hardware or push unnecessary upgrades?",
      plainAnswer: `No. I don't resell hardware and I don't earn commission on anything, so there's no incentive to nudge you towards extras you don't need. The aim is to leave the existing setup working properly. If a replacement part or upgrade genuinely makes sense, I'll lay out the options and the trade-offs and let you decide. If you're not sure what to buy - whether it's a part, a cable, a new device, or any other piece of tech - I can suggest the right thing to get, or pick one up and bring it along, so you don't end up with the wrong product. ${stripEmphasis(partsText)}`,
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
          <p className="mt-2 text-rich-black/80">{renderEmphasised(partsText)}</p>
        </>
      ),
    },
    {
      group: "booking",
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
      group: "booking",
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
      group: "booking",
      question: "What if I cancel last-minute?",
      plainAnswer: stripEmphasis(cancellationText),
      answer: (
        <>
          <p>{renderEmphasised(cancellationText)}</p>
          <p className="mt-2 text-rich-black/80">
            The cancel page itself shows you which window you're in ({cancellationTiers}) before you
            confirm, so there's no surprise.
          </p>
        </>
      ),
    },
    {
      group: "booking",
      question: "What happens if I miss my appointment?",
      plainAnswer: `${noShow.charge} ${noShow.notice}`,
      answer: (
        <>
          <p>{noShow.charge}</p>
          <p className="mt-2 text-rich-black/80">{noShow.notice}</p>
        </>
      ),
    },
    {
      group: "problems",
      question: "Will my files and photos be safe?",
      plainAnswer:
        "Your files get treated as the most valuable thing on the machine. Before anything risky - work on a failing drive, a hardware repair, a system reinstall - I'll explain the risk and, wherever practical, back up your important files first. Nothing gets deleted without checking with you. One honest caveat: recovery from a drive that's already failing can never be guaranteed - a dying disk can give out even when it's handled carefully. I'll always tell you where you stand before any work starts.",
      answer: (
        <>
          <p>
            Your files get treated as the most valuable thing on the machine. Before anything risky
            - work on a failing drive, a hardware repair, a system reinstall - I'll explain the risk
            and, wherever practical, <strong>back up your important files first</strong>. Nothing
            gets deleted without checking with you.
          </p>
          <p className="mt-2 text-rich-black/80">
            One honest caveat: recovery from a drive that's already failing can never be guaranteed
            - a dying disk can give out even when it's handled carefully. I'll always tell you where
            you stand before any work starts.
          </p>
        </>
      ),
    },
    {
      group: "problems",
      question: "What if you can't fix the problem?",
      plainAnswer: stripEmphasis(unsuccessfulText),
      answer: (
        <>
          <p className="whitespace-pre-line">{renderEmphasised(unsuccessfulText)}</p>
        </>
      ),
    },
    // A 0-day window means no guarantee, so drop the question.
    ...(policy.WORKMANSHIP_WINDOW_DAYS > 0
      ? [
          {
            group: "problems" as const,
            question: "What if a problem comes back after your visit?",
            plainAnswer: stripEmphasis(workmanshipText),
            answer: <p className="whitespace-pre-line">{renderEmphasised(workmanshipText)}</p>,
          },
        ]
      : []),
    {
      group: "prices",
      question: "How and when do I pay?",
      plainAnswer: `Nothing is due up front. After the job you'll get an itemised invoice by email - work, travel, and any parts. Pay by bank transfer within ${paymentTermsDays} days, or cash on the day if you prefer.`,
      answer: (
        <>
          <p>
            Nothing is due up front. After the job you'll get an itemised invoice by email - work,
            travel, and any parts.
          </p>
          <p className="mt-2 text-rich-black/80">
            Pay by <strong>bank transfer</strong> within {paymentTermsDays} days (the account
            details are on the invoice), or <strong>cash on the day</strong> if you prefer.
          </p>
        </>
      ),
    },
    {
      group: "prices",
      question: "Do I pay GST?",
      plainAnswer: stripEmphasis(gstText),
      answer: <p>{renderEmphasised(gstText)}</p>,
    },
  ];

  const groups = FAQ_GROUPS.map((group) => ({
    ...group,
    items: faqItems.filter((item) => item.group === group.id),
  }));

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: groups
      .flatMap((group) => group.items)
      .map((item) => ({
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
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(faqJsonLd) }}
      />
      <PageHead
        crumbs={[
          { name: "Home", path: "/" },
          { name: "FAQ", path: "/faq" },
        ]}
        title="Frequently asked questions"
        intro={
          <p>
            Quick answers to common questions. Don&apos;t see yours?{" "}
            <Link href="/contact" className={TEXT_LINK}>
              Get in touch
            </Link>
            .
          </p>
        }
      />

      {groups.map((group, i) => (
        <Section
          key={group.id}
          id={group.id}
          tone={i % 2 === 1 ? "grey" : "white"}
          aria-labelledby={`${group.id}-heading`}
        >
          <SectionHeading id={`${group.id}-heading`} title={group.title} />
          {/* One column so the questions read straight down, not left-right then down. */}
          <div className="max-w-180">
            {group.items.map((item) => (
              <Disclosure key={item.question} title={item.question} titleAs="h3">
                {item.answer}
              </Disclosure>
            ))}
          </div>
        </Section>
      ))}

      <ClosingCta
        title="Still got a question?"
        line="Call or text me, or book online and add it to your notes."
        phone={settings.identity.phone}
        phoneTel={settings.identity.phoneTel}
      />
    </PageShell>
  );
}
