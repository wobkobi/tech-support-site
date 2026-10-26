// src/app/services/[slug]/page.tsx
// One service category's detail page, built from SERVICE_PAGES. Only slugs with written
// content are generated; any other slug 404s and stays a /services#<slug> anchor.

import { formatMoneyCompact } from "@/features/business/lib/business";
import { getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import { getActivePromo, promoDisplayRate, promoForRateCard } from "@/features/business/lib/promos";
import { formatReviewerName } from "@/features/reviews/lib/formatting";
import { ClosingCta } from "@/shared/components/ClosingCta";
import { Notice } from "@/shared/components/Notice";
import { PageHead } from "@/shared/components/PageHead";
import { PageShell } from "@/shared/components/PageLayout";
import { PixelEvent } from "@/shared/components/PixelEvent";
import { PromoPrice } from "@/shared/components/PromoPrice";
import { Section, SectionHeading, TEXT_LINK } from "@/shared/components/Section";
import { TickItem, TickList } from "@/shared/components/TickList";
import { GOOGLE_BUSINESS_PROFILE_URL } from "@/shared/lib/business-profiles";
import { cn } from "@/shared/lib/cn";
import { jsonLdHtml } from "@/shared/lib/json-ld";
import { pageOpenGraph } from "@/shared/lib/open-graph";
import { prisma } from "@/shared/lib/prisma";
import { SERVICE_AREAS } from "@/shared/lib/service-areas";
import { SERVICE_PAGES, SERVICE_PAGE_SLUGS, hasServicePage } from "@/shared/lib/service-pages";
import { getSettings } from "@/shared/lib/settings/get-settings";
import { getSiteUrl } from "@/shared/lib/site-url";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type React from "react";

// ISR like /services, so rate edits reach the page without a redeploy. Review
// moderation purges it sooner through revalidateReviewPaths(). The daily timer is
// only a fallback.
export const revalidate = 86400;
// Only the generated slugs exist; anything else 404s instead of rendering on demand.
export const dynamicParams = false;

const siteUrl = getSiteUrl();

/** Tap-sized link, for links that sit in a row rather than inside a sentence. */
const TAP_LINK = cn(TEXT_LINK, "inline-flex min-h-11 items-center");

/** Route props for this page. */
interface ServicePageProps {
  params: Promise<{ slug: string }>;
}

/** A pinned review ready to render. */
interface PinnedReview {
  id: string;
  text: string;
  name: string;
}

/**
 * The slugs to prerender at build time.
 * @returns One params object per service with a detail page.
 */
export function generateStaticParams(): Array<{ slug: string }> {
  return SERVICE_PAGE_SLUGS.map((slug) => ({ slug }));
}

/**
 * Per-page title, description and self-canonical.
 * @param props - Route props.
 * @param props.params - Route params with the service slug.
 * @returns Page metadata, empty for an unknown slug (the page itself 404s).
 */
export async function generateMetadata({ params }: ServicePageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!hasServicePage(slug)) return {};
  const page = SERVICE_PAGES[slug];
  const path = `/services/${slug}`;
  return {
    title: page.metaTitle,
    description: page.metaDescription,
    alternates: { canonical: path },
    openGraph: pageOpenGraph({
      title: page.metaTitle,
      description: page.metaDescription,
      url: path,
    }),
  };
}

/**
 * Loads the pinned reviews that are still approved, in pinned order. A review that
 * was unapproved or deleted simply drops out.
 * @param ids - Pinned review ids, already validated as ObjectIds by the check script.
 * @returns The surviving reviews, possibly none.
 */
async function pinnedReviews(ids: ReadonlyArray<string>): Promise<PinnedReview[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.review.findMany({
    where: { id: { in: [...ids] }, status: "approved" },
    select: { id: true, text: true, firstName: true, lastName: true, isAnonymous: true },
  });
  return ids.flatMap((id) => {
    const row = rows.find((r) => r.id === id);
    if (!row) return [];
    return [
      { id: row.id, text: row.text.trim().replace(/\s+/g, " "), name: formatReviewerName(row) },
    ];
  });
}

/**
 * Service detail page.
 * @param props - Route props.
 * @param props.params - Route params with the service slug.
 * @returns The page element.
 */
export default async function ServiceDetailPage({
  params,
}: ServicePageProps): Promise<React.ReactElement> {
  const { slug } = await params;
  if (!hasServicePage(slug)) notFound();
  const page = SERVICE_PAGES[slug];
  const area = SERVICE_AREAS.find((a) => a.slug === slug);
  if (!area) notFound();

  const [pricing, { identity }, promo, reviews] = await Promise.all([
    getPublicPricing(),
    getSettings(),
    getActivePromo(),
    pinnedReviews(page.reviewIds),
  ]);
  // Quote the promo rate the same way the FAQ does, or the page contradicts the banner.
  const displayRate = promoDisplayRate(pricing.baseRate, promoForRateCard(promo));
  const rateDiscounted = displayRate !== pricing.baseRate;
  const path = `/services/${slug}`;

  const serviceJsonLd = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: area.label,
    serviceType: area.label,
    description: page.metaDescription,
    url: `${siteUrl}${path}`,
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
    },
  };

  // Mirrors the visible "Questions people ask" list; voice and AI search read FAQ markup.
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faqs.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };

  return (
    <PageShell>
      <PixelEvent event="ViewContent" />
      <script
        id="ld-service"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(serviceJsonLd) }}
      />
      <script
        id="ld-faq"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(faqJsonLd) }}
      />
      <PageHead
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Services", path: "/services" },
          { name: area.label, path },
        ]}
        title={page.heading}
        intro={page.intro}
      />

      <Section aria-labelledby="problems-heading">
        <SectionHeading title={page.problemsHeading} id="problems-heading" />
        <TickList>
          {page.problems.map((problem) => (
            <TickItem key={problem}>{problem}</TickItem>
          ))}
        </TickList>
      </Section>

      <Section tone="grey" aria-labelledby="visit-heading">
        <SectionHeading title="What a visit looks like" id="visit-heading" />
        <ol className="grid max-w-180 gap-4">
          {page.visitSteps.map((step, i) => (
            <li key={step} className="flex gap-4">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-russian-violet font-extrabold text-white"
              >
                {i + 1}
              </span>
              <span className="pt-1">{step}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section aria-labelledby="cost-heading">
        <SectionHeading title="How long it takes and what it costs" id="cost-heading" />
        <div className="max-w-180">
          <p>{page.typicalTime}</p>
          <p className="mt-3">
            I charge{" "}
            <PromoPrice discounted={rateDiscounted} className="font-bold">
              {formatMoneyCompact(displayRate)}/hr
            </PromoPrice>
            {rateDiscounted && " with the current offer"} for the time I spend working, and
            I&apos;ll tell you the expected cost before I start. Home visits also include travel
            time; the{" "}
            <Link href="/pricing" className={TEXT_LINK}>
              pricing page
            </Link>{" "}
            has the details.
          </p>
          <Notice className="mt-8">
            <p className="font-bold">A recent job</p>
            <p className="mt-1">{page.example}</p>
          </Notice>
        </div>
      </Section>

      {reviews.length > 0 && (
        <Section tone="grey" aria-labelledby="reviews-heading">
          <SectionHeading title="What customers said" id="reviews-heading" />
          <ul className="grid gap-4 md:grid-cols-2">
            {reviews.map((r) => (
              <li
                key={r.id}
                className="flex flex-col rounded-lg border-2 border-seasalt-200/60 bg-white/80 p-4 sm:p-5"
              >
                <blockquote>{r.text}</blockquote>
                <p className="pt-3 text-base font-semibold text-russian-violet sm:text-lg">
                  - {r.name}
                </p>
              </li>
            ))}
          </ul>
          {/* Google first: reviews are moving there, site reviews stay until that switch. */}
          <p className="mt-5 flex flex-wrap gap-x-6">
            <a
              href={GOOGLE_BUSINESS_PROFILE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={TAP_LINK}
            >
              See my reviews on Google
            </a>
            <Link href="/reviews" className={TAP_LINK}>
              Read all reviews
            </Link>
          </p>
        </Section>
      )}

      {/* Tones alternate, so FAQ takes grey when the reviews band isn't there. */}
      <Section tone={reviews.length > 0 ? "white" : "grey"} aria-labelledby="faq-heading">
        <SectionHeading title="Questions people ask" id="faq-heading" />
        <dl className="grid max-w-180 gap-6">
          {page.faqs.map(({ q, a }) => (
            <div key={q}>
              <dt className="text-lg font-extrabold text-russian-violet">{q}</dt>
              <dd className="mt-1">{a}</dd>
            </div>
          ))}
        </dl>
        <h2 className="mt-12 mb-3 text-[1.375rem] font-extrabold">Related help</h2>
        <ul className="flex flex-wrap gap-x-6 gap-y-1">
          {page.related.map((rel) => (
            <li key={rel}>
              <Link href={`/services/${rel}`} className={TAP_LINK}>
                {SERVICE_AREAS.find((a) => a.slug === rel)?.label ?? SERVICE_PAGES[rel].heading}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/services" className={TAP_LINK}>
              All services
            </Link>
          </li>
        </ul>
      </Section>

      <ClosingCta
        title="Want a hand with this?"
        line="Book online, or call or text and I'll help you work out what you need."
        phone={identity.phone}
        phoneTel={identity.phoneTel}
      />
    </PageShell>
  );
}
