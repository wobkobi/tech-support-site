// src/app/page.tsx
/**
 * @description Main landing page for tech support company.
 */

import Reviews, { type ReviewItem } from "@/features/reviews/components/Reviews";
import { formatReviewerName } from "@/features/reviews/lib/formatting";
import { Button } from "@/shared/components/Button";
import { FrostedSection, PageShell, CARD as SHARED_CARD } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import { prisma } from "@/shared/lib/prisma";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import Image from "next/image";
import type React from "react";
import type { IconType } from "react-icons";
import {
  FaCalendarCheck,
  FaCircleCheck,
  FaCloud,
  FaDownload,
  FaEnvelope,
  FaHandshake,
  FaHouse,
  FaImages,
  FaLaptop,
  FaMapLocationDot,
  FaMobileScreen,
  FaPhone,
  FaPrint,
  FaRightLeft,
  FaShieldHalved,
  FaToolbox,
  FaTv,
  FaWifi,
} from "react-icons/fa6";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
    languages: { "en-NZ": "/" },
  },
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

interface SupportItem {
  label: string;
  icon: IconType;
}

const supportItems: ReadonlyArray<SupportItem> = [
  { label: "Computers & Laptops", icon: FaLaptop },
  { label: "Phones & Tablets", icon: FaMobileScreen },
  { label: "Wi-Fi & Networks", icon: FaWifi },
  { label: "Smart TVs", icon: FaTv },
  { label: "Smart Home", icon: FaHouse },
  { label: "Printers", icon: FaPrint },
  { label: "Cloud & Backups", icon: FaCloud },
  { label: "Email Setup", icon: FaEnvelope },
  { label: "Security", icon: FaShieldHalved },
  { label: "Data Transfer", icon: FaRightLeft },
  { label: "Repairs", icon: FaToolbox },
  { label: "Photo Storage", icon: FaImages },
];

// Home cards are the shared CARD with a touch more padding on md+. Deriving
// from SHARED_CARD keeps the border/background in sync instead of drifting.
const CARD = cn(SHARED_CARD, "md:p-7");

/**
 * Home page component
 * @returns Home page element
 */
export default async function Home(): Promise<React.ReactElement> {
  const [allRows, settings] = await Promise.all([
    getApprovedReviews().catch(() => []),
    getSettings(),
  ]);
  const rows = allRows.slice(0, settings.reviews.homepageFeaturedCount);

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
      <FrostedSection>
        <div className="flex flex-col gap-6 sm:gap-8">
          {/* Hero Section */}
          <section aria-labelledby="hero-heading" className="text-center">
            <div className="mb-6 grid place-items-center">
              <Image
                src="/source/logo-full.svg"
                alt="To The Point Tech - computer and IT support in Auckland"
                width={2000}
                height={674}
                priority
                fetchPriority="high"
                draggable={false}
                className="h-auto w-70 sm:w-95 md:w-120 lg:w-140"
              />
            </div>

            <h1
              id="hero-heading"
              className="mx-auto mb-4 max-w-5xl text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl"
            >
              Computer & IT Support in Auckland
            </h1>

            <p className="mx-auto mb-8 max-w-7xl text-lg font-medium text-rich-black sm:text-xl md:text-2xl">
              Friendly tech help across Auckland. Clear explanations, no jargon, and solutions that
              actually work.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-4">
              <Button href="/booking" variant="primary" size="md" className="h-12">
                <FaCalendarCheck className="h-5 w-5" aria-hidden />
                Book appointment
              </Button>
              <Button href={settings.identity.phoneTel} variant="secondary" size="md">
                <FaPhone className="h-4 w-4" aria-hidden />
                {settings.identity.phone}
              </Button>
            </div>

            <p className="mt-6 text-base text-rich-black/70 sm:text-lg">
              Same day appointments available • Evening & weekend hours • Remote support options
            </p>
          </section>

          {/* Trust Indicators */}
          <section aria-labelledby="trust-heading" className="grid gap-4 sm:grid-cols-3 sm:gap-5">
            {/* Visually hidden: gives the card h3s an h2 parent so heading order
                does not skip from the hero h1 straight to h3. */}
            <h2 id="trust-heading" className="sr-only">
              Why choose us
            </h2>
            <div
              className={cn(
                CARD,
                "animate-slide-up animate-fill-both animate-delay-100 text-center",
              )}
            >
              <div className="mx-auto mb-3 grid size-16 place-items-center rounded-full border-2 border-moonstone-500/50 bg-moonstone-600/30">
                <FaCircleCheck className="h-8 w-8 text-moonstone-600" aria-hidden />
              </div>
              <h3 className="mb-2 text-xl font-bold text-russian-violet sm:text-2xl">
                Computer Science Graduate
              </h3>
              <p className="text-base text-rich-black/80 sm:text-lg">
                University-trained with real-world experience
              </p>
            </div>

            <div
              className={cn(
                CARD,
                "animate-slide-up animate-fill-both animate-delay-200 text-center",
              )}
            >
              <div className="mx-auto mb-3 grid size-16 place-items-center rounded-full border-2 border-moonstone-500/50 bg-moonstone-600/30">
                <FaMapLocationDot className="h-8 w-8 text-moonstone-600" aria-hidden />
              </div>
              <h3 className="mb-2 text-xl font-bold text-russian-violet sm:text-2xl">
                Proudly Local
              </h3>
              <p className="text-base text-rich-black/80 sm:text-lg">
                Auckland born and raised, on-site across the city
              </p>
            </div>

            <div
              className={cn(
                CARD,
                "animate-slide-up animate-fill-both animate-delay-300 text-center",
              )}
            >
              <div className="mx-auto mb-3 grid size-16 place-items-center rounded-full border-2 border-moonstone-500/50 bg-moonstone-600/30">
                <FaHandshake className="h-8 w-8 text-moonstone-600" aria-hidden />
              </div>
              <h3 className="mb-2 text-xl font-bold text-russian-violet sm:text-2xl">
                No Upselling
              </h3>
              <p className="text-base text-rich-black/80 sm:text-lg">
                Honest advice, fair pricing, clear communication
              </p>
            </div>
          </section>

          {/* Services Grid */}
          <section
            aria-labelledby="services-heading"
            className="animate-slide-up animate-fill-both animate-delay-200 text-center"
          >
            <h2
              id="services-heading"
              className="mb-8 text-3xl font-bold text-rich-black sm:text-4xl md:text-5xl"
            >
              What I can help with
            </h2>

            <ul className="mx-auto grid max-w-6xl grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {supportItems.map(({ label, icon: Icon }) => (
                <li
                  key={label}
                  className="flex items-center gap-3 rounded-xl border border-seasalt-400/60 bg-seasalt-800 p-3 shadow-sm transition-all hover:shadow-md"
                >
                  <span className="grid size-12 shrink-0 place-items-center rounded-lg border border-moonstone-500/50 bg-moonstone-600/30 sm:size-14">
                    <Icon className="h-7 w-7 text-moonstone-600 sm:h-8 sm:w-8" aria-hidden />
                  </span>
                  <span className="line-clamp-2 text-left text-base leading-tight font-medium text-rich-black sm:text-lg">
                    {label}
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-8 text-center">
              <Button href="/services" variant="tertiary" size="md">
                View all services
              </Button>
            </div>
          </section>

          {/* About & Approach */}
          <section aria-label="About and approach" className="grid gap-5 md:grid-cols-2 md:gap-6">
            <article className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-300")}>
              <h2 className="mb-4 text-2xl font-bold text-russian-violet sm:text-3xl">About Me</h2>
              <p className="mb-4 text-base text-rich-black sm:text-lg">
                Hi, I'm Harrison, a computer science graduate based in Auckland. I started To The
                Point Tech to give locals a reliable, friendly person to call when technology acts
                up.
              </p>
              <p className="text-base text-rich-black/90 sm:text-lg">
                I focus on practical fixes and clear explanations, leaving with your problems
                solved.
              </p>
            </article>

            <article className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-400")}>
              <h2 className="mb-4 text-2xl font-bold text-russian-violet sm:text-3xl">
                My approach
              </h2>
              <ul className="space-y-3 text-base text-rich-black sm:text-lg">
                <li className="flex gap-3">
                  <FaCircleCheck className="mt-1 h-5 w-5 shrink-0 text-moonstone-600" aria-hidden />
                  <span>Listen first, understand your needs</span>
                </li>
                <li className="flex gap-3">
                  <FaCircleCheck className="mt-1 h-5 w-5 shrink-0 text-moonstone-600" aria-hidden />
                  <span>Explain everything as clearly as possible</span>
                </li>
                <li className="flex gap-3">
                  <FaCircleCheck className="mt-1 h-5 w-5 shrink-0 text-moonstone-600" aria-hidden />
                  <span>Leave clear notes you can refer back to</span>
                </li>
                <li className="flex gap-3">
                  <FaCircleCheck className="mt-1 h-5 w-5 shrink-0 text-moonstone-600" aria-hidden />
                  <span>Transparent pricing, no hidden fees</span>
                </li>
              </ul>
            </article>
          </section>

          {/* Download Flyer */}
          <section
            aria-labelledby="flyer-heading"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-500")}
          >
            <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:text-left">
              <div className="grid size-16 shrink-0 place-items-center rounded-full border-2 border-moonstone-500/50 bg-moonstone-600/30">
                <FaDownload className="h-8 w-8 -translate-y-0.5 text-moonstone-600" aria-hidden />
              </div>

              <div className="flex-1">
                <h2
                  id="flyer-heading"
                  className="mb-1 text-xl font-bold text-russian-violet sm:text-2xl"
                >
                  Know someone who needs tech help?
                </h2>
                <p className="text-base text-rich-black/80 sm:text-lg">
                  Download this flyer to share with neighbours or pin to a noticeboard.
                </p>
              </div>

              <Button
                href="/downloads/poster-a5.pdf"
                download="to-the-point-tech-flyer.pdf"
                variant="tertiary"
                size="md"
                className="shrink-0"
              >
                Download flyer
              </Button>
            </div>
          </section>
        </div>
      </FrostedSection>

      {/* Reviews Section */}
      {hasReviews && (
        <div className="animate-fade-in animate-delay-500 animate-fill-both pb-6 sm:pb-8">
          <FrostedSection>
            <Reviews items={items} />
          </FrostedSection>
        </div>
      )}

      {/* Contact Footer */}
      <footer className="mx-auto mb-6 w-fit max-w-[calc(100vw-2rem)] sm:mb-8">
        <div className="flex flex-col items-center gap-1 rounded-xl border border-seasalt-400/40 bg-seasalt-800/70 p-4 shadow-lg backdrop-blur-md sm:flex-row sm:gap-8 sm:px-6 sm:py-4">
          <a
            href={settings.identity.phoneTel}
            className="flex items-center gap-3 rounded-md px-4 py-2 text-base font-bold text-russian-violet transition-colors hover:text-coquelicot-500 sm:text-lg"
          >
            <FaPhone className="h-4 w-4 shrink-0 sm:h-6 sm:w-6" aria-hidden />
            <span>{settings.identity.phone}</span>
          </a>

          <div className="hidden h-6 w-px bg-seasalt-400/50 sm:block" />

          <a
            href={`mailto:${settings.identity.email}`}
            className="flex items-center gap-3 rounded-md px-4 py-2 text-base font-bold text-russian-violet transition-colors hover:text-coquelicot-500 sm:text-lg"
          >
            <FaEnvelope className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" aria-hidden />
            <span>{settings.identity.email}</span>
          </a>
        </div>
      </footer>
    </PageShell>
  );
}
