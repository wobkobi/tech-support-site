// src/app/(home)/page.tsx
// Main landing page for tech support company.

import Reviews, { type ReviewItem } from "@/features/reviews/components/Reviews";
import { formatReviewerName } from "@/features/reviews/lib/formatting";
import { Button } from "@/shared/components/Button";
import { ClosingCta } from "@/shared/components/ClosingCta";
import { PageShell } from "@/shared/components/PageLayout";
import { RuledBlock, RuledGrid } from "@/shared/components/RuledGrid";
import { CONTAINER, Section, SectionHeading, TEXT_LINK } from "@/shared/components/Section";
import { TickItem, TickList } from "@/shared/components/TickList";
import { GOOGLE_BUSINESS_PROFILE_URL } from "@/shared/lib/business-profiles";
import { cn } from "@/shared/lib/cn";
import { prisma } from "@/shared/lib/prisma";
import { SERVICE_AREAS } from "@/shared/lib/service-areas";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import Image from "next/image";
import Link from "next/link";
import type React from "react";
import { FaCalendarCheck, FaCheck, FaDownload, FaPhone } from "react-icons/fa6";

export const metadata: Metadata = {
  // Self-canonical only. A lone en-NZ hreflang with no x-default and no sibling
  // locales is malformed (hreflang describes multi-locale clusters, which this
  // single-language site does not have) and only muddies Google's signals, so
  // match every other page and emit just the canonical.
  alternates: { canonical: "/" },
};

// Rely on on-demand revalidation (revalidateReviewPaths fires on every review change).
// Long fallback avoids waking a cold DB on a fixed timer.
export const revalidate = 86400;

/**
 * Cached review query, tagged so revalidateReviewPaths() can invalidate it.
 * Caching the query separately from the page means repeated ISR regenerations
 * within the TTL window skip the DB round-trip entirely.
 */
// Cache a generous pool; the home page slices it to the operator's configured
// featured count so changing that count takes effect without busting this cache.
const getApprovedReviews = unstable_cache(
  async () =>
    prisma.review.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, text: true, firstName: true, lastName: true, isAnonymous: true },
      where: { status: "approved" },
      take: 50,
    }),
  ["home-approved-reviews"],
  { tags: ["reviews"], revalidate: 86400 },
);

/** The home page shows at most this many quotes; the full list lives on /reviews. */
const HOME_REVIEW_LIMIT = 3;

// For a text link standing on its own line: a 44px row, so it is easy to tap. Not on
// TEXT_LINK itself, which also sits inside running paragraphs.
const TAP_LINK = "inline-flex min-h-11 items-center";

/** Short ticked points under the hero buttons. */
const HERO_POINTS: ReadonlyArray<string> = [
  "Same-day appointments",
  "Evenings & weekends",
  "Remote support",
];

/** Lines in the "How I work" panel. */
const APPROACH: ReadonlyArray<string> = [
  "Listen first, understand your needs",
  "Explain everything as clearly as possible",
  "Leave clear notes you can refer back to",
  "Transparent pricing, no hidden fees",
];

/** Three blocks in the violet "Why people call me" band. */
const TRUST_POINTS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Computer science graduate",
    body: "A computer science degree behind the advice, plus years of hands-on experience.",
  },
  {
    title: "Proudly local",
    body: "Auckland born and raised, and I come to you anywhere in the city.",
  },
  {
    title: "No upselling",
    body: "If you don't need something, I'll say so - you won't be sold anything extra.",
  },
];

/**
 * Home page component
 * @returns Home page element
 */
export default async function Home(): Promise<React.ReactElement> {
  const [allRows, settings] = await Promise.all([
    getApprovedReviews().catch(() => []),
    getSettings(),
  ]);
  // The featured-count setting still gates the section (0 hides it); the grid caps at three.
  const rows = allRows.slice(
    0,
    Math.min(settings.reviews.homepageFeaturedCount, HOME_REVIEW_LIMIT),
  );
  const { phone, phoneTel } = settings.identity;

  const items: ReviewItem[] = rows.map((r) => ({
    id: r.id,
    text: r.text.trim().replace(/\s+/g, " "),
    name: formatReviewerName({
      firstName: r.firstName?.trim() || null,
      lastName: r.lastName?.trim() || null,
      isAnonymous: r.isAnonymous,
    }),
  }));
  const hasReviews = items.length > 0;

  return (
    <PageShell>
      {/* Hero: the one place the sunset photo appears. The overlay is darkest
          behind the text so white copy holds 4.5:1 at the photo's brightest. */}
      <section
        aria-labelledby="hero-heading"
        className="relative isolate overflow-hidden bg-russian-violet text-white"
      >
        <Image
          src="/source/backdrop.jpg"
          alt=""
          fill
          // The mobile LCP element. Eager + high priority rather than preload: Next 16's
          // preload link carries no fetchpriority hint, which the LCP audit flags.
          loading="eager"
          fetchPriority="high"
          sizes="100vw"
          className="-z-20 object-cover object-[50%_60%] md:object-[70%_58%]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(6,5,31,.78),rgba(6,5,31,.45))] md:bg-[linear-gradient(90deg,rgba(6,5,31,.82)_0%,rgba(6,5,31,.5)_42%,rgba(6,5,31,.05)_75%)]"
        />
        <div
          className={cn(
            CONTAINER,
            "grid items-center gap-8 pt-8 pb-10 sm:py-14 md:grid-cols-[1.25fr_1fr] md:gap-12 md:py-22",
          )}
        >
          <div>
            <h1
              id="hero-heading"
              className="mb-4 text-[2rem] leading-[1.1] font-extrabold sm:text-[2.875rem]"
            >
              Computer Repairs &amp; IT Support in Auckland
            </h1>
            <p className="mb-6 max-w-170 text-lg sm:text-[1.1875rem]">
              I come to your home or business anywhere in Auckland, fix the problem, explain what
              went wrong in plain English, and don&apos;t leave until it actually works.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button href="/booking" variant="primary" className="w-full sm:w-auto">
                <FaCalendarCheck className="h-5 w-5" aria-hidden />
                Book appointment
              </Button>
              <Button href={phoneTel} variant="outline-white" className="w-full sm:w-auto">
                <FaPhone className="h-4 w-4" aria-hidden />
                Call {phone}
              </Button>
            </div>
            <ul className="mt-6 flex flex-col gap-2 text-base font-semibold sm:flex-row sm:flex-wrap sm:gap-x-5">
              {HERO_POINTS.map((point) => (
                <li key={point} className="flex items-center gap-2">
                  <FaCheck className="h-4 w-4 text-moonstone-500" aria-hidden />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <figure className="relative m-0 max-w-104 md:max-w-none">
            <Image
              src="/source/harrison-2026.jpg"
              alt="Harrison Raynes"
              width={2160}
              height={2160}
              sizes="(min-width: 768px) 40vw, 100vw"
              className="aspect-4/3 w-full rounded-lg object-cover object-[center_25%] shadow-[0_10px_30px_rgba(0,0,0,0.35)] sm:aspect-square"
            />
            <figcaption className="absolute bottom-4 left-4 rounded-md bg-white px-3.5 py-2.5 text-[0.9375rem] text-rich-black shadow-[0_4px_14px_rgba(0,0,0,0.12)]">
              <b className="block text-base">Harrison Raynes</b>
              Owner and Technician
            </figcaption>
          </figure>
        </div>
      </section>

      <Section
        aria-labelledby="about-heading"
        containerClassName="grid items-start gap-8 lg:grid-cols-[1.2fr_1fr] lg:gap-14"
      >
        <div>
          <SectionHeading
            eyebrow="About me"
            title="Hi, I'm Harrison"
            id="about-heading"
            className="mb-4"
          />
          <p>
            I&apos;m a computer science graduate based in Auckland. I started To the Point Tech
            because when something breaks, people want someone who turns up and sorts it out
            properly.
          </p>
          <p className="mt-3.5">
            That&apos;s what I do. I&apos;ll explain what went wrong, what I did about it, and
            whether it&apos;s worth spending money on - including when it isn&apos;t.
          </p>
          <p className="mt-5">
            <Link href="/about" className={cn(TEXT_LINK, TAP_LINK)}>
              More about me
            </Link>
          </p>
        </div>
        <div className="rounded-lg bg-seasalt p-7">
          <h3 className="mb-3.5 text-[1.3125rem] font-extrabold">How I work</h3>
          <TickList>
            {APPROACH.map((line) => (
              <TickItem key={line}>{line}</TickItem>
            ))}
          </TickList>
        </div>
      </Section>

      <Section tone="grey" aria-labelledby="services-heading">
        <SectionHeading
          eyebrow="Services"
          title="What I can help with"
          id="services-heading"
          lead="Home and small business, Windows and Mac, phones and tablets. If it plugs in or connects to Wi-Fi, ask."
          className="mb-0"
        />
        <ul className="mt-8 grid border-t border-seasalt-200 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICE_AREAS.map(({ slug, label, blurb }) => (
            <li key={slug} className="border-b border-seasalt-200">
              <Link href={`/services#${slug}`} className="group block py-3.5 sm:py-4.5 sm:pr-4.5">
                <b className="block text-lg group-hover:text-coquelicot-700">{label}</b>
                <span className="text-base text-seasalt-700">{blurb}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-7">
          <Link href="/services" className={cn(TEXT_LINK, TAP_LINK)}>
            See all services and what&apos;s included
          </Link>
        </p>
      </Section>

      <Section tone="violet" aria-labelledby="why-heading">
        <SectionHeading
          onDark
          eyebrow="Why people call me"
          title="Someone local who explains it properly"
          id="why-heading"
          className="mb-7"
        />
        <RuledGrid cols={3}>
          {TRUST_POINTS.map((p) => (
            <RuledBlock key={p.title} title={p.title}>
              <p className="text-russian-violet-100">{p.body}</p>
            </RuledBlock>
          ))}
        </RuledGrid>
      </Section>

      <Section
        tone="grey"
        aria-labelledby="business-heading"
        containerClassName="flex flex-wrap items-center justify-between gap-8"
      >
        <div className="max-w-160">
          <SectionHeading
            eyebrow="For businesses"
            title="Run a small business?"
            id="business-heading"
            className="mb-3"
          />
          <p className="text-seasalt-700">
            Call me out when something breaks, or put me on a monthly retainer so it&apos;s covered
            either way. No lock-in, and you can switch between the two whenever it suits.
          </p>
        </div>
        <Button href="/business" variant="outline">
          Business IT support
        </Button>
      </Section>

      {hasReviews && (
        <Section aria-labelledby="reviews-heading">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <SectionHeading
              eyebrow="Reviews"
              title="What people say"
              id="reviews-heading"
              className="mb-0"
            />
            {/* Google first: reviews are moving there, site reviews stay until that switch. */}
            <span className="flex flex-wrap gap-x-6">
              <a
                href={GOOGLE_BUSINESS_PROFILE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(TEXT_LINK, TAP_LINK)}
              >
                See my reviews on Google
              </a>
              <Link href="/reviews" className={cn(TEXT_LINK, TAP_LINK)}>
                Read all reviews
              </Link>
            </span>
          </div>
          <Reviews items={items} />
        </Section>
      )}

      {/* With reviews above, the flyer strip shares their white band, so it drops its top padding. */}
      <Section aria-labelledby="flyer-heading" className={hasReviews ? "pt-0 sm:pt-0" : undefined}>
        <div className="flex flex-wrap items-center justify-between gap-5 rounded-lg border-2 border-dashed border-seasalt-200 px-6 py-5">
          <div>
            <h2 id="flyer-heading" className="text-xl font-extrabold">
              Know someone who needs tech help?
            </h2>
            <p className="mt-1.5 text-base text-seasalt-700">
              Download the flyer to share with neighbours or pin to a noticeboard.
            </p>
          </div>
          <Button
            href="/downloads/poster-a5.pdf"
            download="to-the-point-tech-flyer.pdf"
            variant="outline"
          >
            <FaDownload className="h-4 w-4" aria-hidden />
            Download flyer (PDF)
          </Button>
        </div>
      </Section>

      <ClosingCta
        title="Something not working?"
        line="Book online in a couple of minutes, or give me a call."
        phone={phone}
        phoneTel={phoneTel}
      />
    </PageShell>
  );
}
