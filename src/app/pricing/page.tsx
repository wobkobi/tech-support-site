// src/app/pricing/page.tsx
/**
 * @file page.tsx
 * @description Pricing page: transparent pricing structure for tech support services.
 */

import type { Metadata } from "next";
import type React from "react";
import Link from "next/link";
import { FrostedSection, PageShell, CARD, SOFT_CARD } from "@/shared/components/PageLayout";
import { BreadcrumbJsonLd } from "@/shared/components/BreadcrumbJsonLd";
import { cn } from "@/shared/lib/cn";
import { PricingWizard } from "@/features/business/components/PricingWizard";
import {
  applyPromoToHourlyRate,
  getActivePromo,
  summariseForBanner,
} from "@/features/business/lib/promos";
import { formatDateShort } from "@/shared/lib/date-format";

// Promo state changes metadata text; cached lookup keeps this cheap.
export const dynamic = "force-dynamic";

/**
 * Builds page metadata; reflects the active promo in title/description.
 * @returns Metadata object.
 */
export async function generateMetadata(): Promise<Metadata> {
  const promo = await getActivePromo();
  const rateBlurb = promo
    ? `Limited offer: ${summariseForBanner(promo)}.`
    : "$65/h for most jobs, $85/h for complex work.";
  return {
    title: promo
      ? `Pricing - ${summariseForBanner(promo)} | To The Point Tech`
      : "Pricing - $65/h Tech Support in Auckland",
    description: `Transparent tech support pricing in Auckland. ${rateBlurb} No hidden fees, no upselling. On-site and remote rates the same.`,
    keywords: [
      "tech support pricing Auckland",
      "computer repair cost Auckland",
      "IT support hourly rate Auckland",
      "affordable tech support Auckland",
      "transparent IT pricing NZ",
    ],
    alternates: { canonical: "/pricing" },
    openGraph: {
      title: "Pricing - To The Point Tech",
      description: `Simple, transparent rates. ${rateBlurb}`,
      url: "/pricing",
    },
  };
}

const linkStyle = cn(
  "text-coquelicot-500 hover:text-coquelicot-600 underline-offset-4 hover:underline",
);

/**
 * Pricing page; branches rate cards on the active promo server-side.
 * @returns Pricing page element.
 */
export default async function PricingPage(): Promise<React.ReactElement> {
  const promo = await getActivePromo();
  return (
    <PageShell>
      <BreadcrumbJsonLd
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Pricing", path: "/pricing" },
        ]}
      />
      <FrostedSection>
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section aria-labelledby="pricing-heading" className={cn(CARD, "animate-fade-in")}>
            <h1
              id="pricing-heading"
              className={cn(
                "text-russian-violet mb-4 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Pricing
            </h1>
            <p className={cn("text-rich-black mb-4 text-sm sm:text-base")}>
              Simple, transparent pricing. You'll always know the cost before work begins, and
              there's no pressure to buy anything you don't need.
            </p>
          </section>

          <section
            aria-label="Rates"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}
          >
            <h2 className={cn("text-russian-violet mb-3 text-xl font-bold sm:text-2xl")}>Rates</h2>

            {promo ? (
              <>
                <div className={cn("grid gap-4 sm:grid-cols-2")}>
                  <div className={cn("border-mustard-400 bg-mustard-900 rounded-lg border p-5")}>
                    <p className={cn("text-rich-black/60 mb-1 text-lg line-through sm:text-xl")}>
                      $65/h
                    </p>
                    <p className={cn("text-russian-violet mb-2 text-3xl font-bold sm:text-4xl")}>
                      ${applyPromoToHourlyRate(65, promo).toFixed(0)}/h
                    </p>
                    <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
                      Most jobs - troubleshooting, setup, software, tune-ups, Wi-Fi, backups, and
                      more.
                    </p>
                  </div>

                  <div className={cn("border-mustard-400 bg-mustard-900 rounded-lg border p-5")}>
                    <p className={cn("text-rich-black/60 mb-1 text-lg line-through sm:text-xl")}>
                      $85/h
                    </p>
                    <p className={cn("text-russian-violet mb-2 text-3xl font-bold sm:text-4xl")}>
                      ${applyPromoToHourlyRate(85, promo).toFixed(0)}/h
                    </p>
                    <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
                      Complex or lengthy work - data recovery, hardware repairs, or full PC
                      migrations.
                    </p>
                  </div>
                </div>

                <div
                  className={cn(
                    "bg-mustard-500 text-russian-violet-500 mt-4 rounded-lg px-4 py-3 text-center",
                  )}
                >
                  <p className={cn("text-sm font-bold sm:text-base")}>
                    ⚡ Limited offer: {promo.title}
                    {promo.description ? ` - ${promo.description}` : ""}
                  </p>
                  <p className={cn("text-russian-violet-500/80 mt-1 text-xs sm:text-sm")}>
                    Until {formatDateShort(promo.endAt)}.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className={cn("grid gap-4 sm:grid-cols-2")}>
                  <div
                    className={cn("bg-seasalt-900/40 border-seasalt-400/60 rounded-lg border p-5")}
                  >
                    <p className={cn("text-russian-violet mb-2 text-3xl font-bold sm:text-4xl")}>
                      $65/h
                    </p>
                    <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
                      Most jobs - troubleshooting, setup, software, tune-ups, Wi-Fi, backups, and
                      more.
                    </p>
                  </div>

                  <div
                    className={cn("bg-seasalt-900/40 border-seasalt-400/60 rounded-lg border p-5")}
                  >
                    <p className={cn("text-russian-violet mb-2 text-3xl font-bold sm:text-4xl")}>
                      $85/h
                    </p>
                    <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
                      Complex or lengthy work - data recovery, hardware repairs, or full PC
                      migrations.
                    </p>
                  </div>
                </div>
                <p className={cn("text-rich-black/70 mt-3 text-xs sm:text-sm")}>
                  Discounts available - just ask. Students and at-home jobs get a small reduction.
                </p>
              </>
            )}

            <a
              href="#estimate-heading"
              className={cn(
                "mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white",
                "bg-russian-violet hover:bg-russian-violet/90 transition-colors",
              )}
            >
              Get a rough estimate ↓
            </a>

            <div className={cn("mt-5 space-y-3")}>
              <p className={cn("text-rich-black/90 flex gap-3 text-sm sm:text-base")}>
                <span className={cn("text-moonstone-600 mt-1 text-lg")}>✓</span>
                <span>
                  <strong>Quick calls and emails are free.</strong> If you have a simple question,
                  just reach out.
                </span>
              </p>
              <p className={cn("text-rich-black/90 flex gap-3 text-sm sm:text-base")}>
                <span className={cn("text-moonstone-600 mt-1 text-lg")}>✓</span>
                <span>
                  <strong>Most jobs take 1 to 2 hours.</strong> I'll give you a time estimate before
                  we start.
                </span>
              </p>
              <p className={cn("text-rich-black/90 flex gap-3 text-sm sm:text-base")}>
                <span className={cn("text-moonstone-600 mt-1 text-lg")}>✓</span>
                <span>
                  <strong>Not sure which rate applies?</strong> Just ask - I'll confirm before
                  starting.
                </span>
              </p>
            </div>
          </section>

          <section
            aria-label="How pricing works"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-200")}
          >
            <h2 className={cn("text-russian-violet mb-3 text-xl font-bold sm:text-2xl")}>
              On-site vs Remote
            </h2>

            <div className={cn("grid gap-5 sm:grid-cols-2")}>
              <div className={cn(SOFT_CARD)}>
                <h3 className={cn("text-russian-violet mb-3 text-lg font-semibold sm:text-xl")}>
                  On-site visits
                </h3>
                <ul className={cn("text-rich-black space-y-2.5 text-sm sm:text-base")}>
                  <li className={cn("flex gap-3")}>
                    <span className={cn("text-moonstone-600 mt-1 text-lg")}>•</span>
                    <span>Same hourly rate applies</span>
                  </li>
                  <li className={cn("flex gap-3")}>
                    <span className={cn("text-moonstone-600 mt-1 text-lg")}>•</span>
                    <span>Travel to your location included</span>
                  </li>
                  <li className={cn("flex gap-3")}>
                    <span className={cn("text-moonstone-600 mt-1 text-lg")}>•</span>
                    <span>
                      Best for: Wi-Fi setup, printers, smart TVs, physical hardware, anything
                      needing hands-on work
                    </span>
                  </li>
                </ul>
              </div>

              <div className={cn(SOFT_CARD)}>
                <h3 className={cn("text-russian-violet mb-3 text-lg font-semibold sm:text-xl")}>
                  Remote support
                </h3>
                <ul className={cn("text-rich-black space-y-2.5 text-sm sm:text-base")}>
                  <li className={cn("flex gap-3")}>
                    <span className={cn("text-moonstone-600 mt-1 text-lg")}>•</span>
                    <span>Cost varies normally less than on-site visits</span>
                  </li>
                  <li className={cn("flex gap-3")}>
                    <span className={cn("text-moonstone-600 mt-1 text-lg")}>•</span>
                    <span>No travel time means quicker turnaround</span>
                  </li>
                  <li className={cn("flex gap-3")}>
                    <span className={cn("text-moonstone-600 mt-1 text-lg")}>•</span>
                    <span>
                      Best for: account issues, software setup, email problems, quick fixes,
                      follow-up support
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section
            aria-labelledby="no-surprises-heading"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-300")}
          >
            <h2
              id="no-surprises-heading"
              className={cn("text-russian-violet mb-3 text-xl font-bold sm:text-2xl")}
            >
              No surprises
            </h2>

            <ul className={cn("text-rich-black space-y-2.5 text-sm sm:text-base")}>
              <li className={cn("flex gap-3")}>
                <span className={cn("text-moonstone-600 mt-1 text-lg")}>•</span>
                <span>
                  <strong>No hidden fees.</strong> The price I quote is the price you pay.
                </span>
              </li>
              <li className={cn("flex gap-3")}>
                <span className={cn("text-moonstone-600 mt-1 text-lg")}>•</span>
                <span>
                  <strong>No upselling.</strong> I don't sell hardware or earn commission on
                  products.
                </span>
              </li>
              <li className={cn("flex gap-3")}>
                <span className={cn("text-moonstone-600 mt-1 text-lg")}>•</span>
                <span>
                  <strong>Fair pricing for unsuccessful work.</strong> If I can't fix the problem,
                  on-site visits are half price. Remote support is usually free, though I may charge
                  for extended troubleshooting sessions.
                </span>
              </li>
              <li className={cn("flex gap-3")}>
                <span className={cn("text-moonstone-600 mt-1 text-lg")}>•</span>
                <span>
                  <strong>Clear communication.</strong> If a job is taking longer than expected,
                  I'll let you know before continuing.
                </span>
              </li>
            </ul>
          </section>

          <section
            aria-label="Next steps"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-400")}
          >
            <p className={cn("text-rich-black text-sm sm:text-base")}>
              <Link href="/contact" className={linkStyle}>
                Get in touch
              </Link>{" "}
              with a description of what you need, and I'll send you an estimate. Or{" "}
              <Link href="/booking" className={linkStyle}>
                book online
              </Link>{" "}
              if you're ready to go.
            </p>
          </section>

          <section
            aria-labelledby="estimate-heading"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-500")}
          >
            <h2
              id="estimate-heading"
              className={cn("text-russian-violet mb-1 text-xl font-bold sm:text-2xl")}
            >
              Get a rough estimate
            </h2>
            <p className={cn("text-rich-black/70 mb-5 text-sm sm:text-base")}>
              Answer a few quick questions to get a price range. No commitment required.
            </p>
            <PricingWizard />
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
