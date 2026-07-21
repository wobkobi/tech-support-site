// src/app/pricing/page.tsx
/**
 * @description Pricing page. Rates come from RateConfig (shared with the
 * calculator and wizard); accordion copy comes from pricing-policy.ts so the
 * page, booking emails, and FAQ stay aligned.
 */

import { GetEstimateButton } from "@/features/business/components/GetEstimateButton";
import { PricingWizard } from "@/features/business/components/PricingWizard";
import {
  cancellationCopy,
  gstCopy,
  minimumsCopy,
  publicHolidayCopy,
  travelCopy,
  unsuccessfulWorkCopy,
} from "@/features/business/lib/pricing-policy";
import { getPolicy, getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import {
  applyPromoToHourlyRate,
  getActivePromo,
  summariseForBanner,
} from "@/features/business/lib/promos";
import { BreadcrumbJsonLd } from "@/shared/components/BreadcrumbJsonLd";
import { CARD, FrostedSection, PageShell, SOFT_CARD } from "@/shared/components/PageLayout";
import { PixelEvent } from "@/shared/components/PixelEvent";
import { cn } from "@/shared/lib/cn";
import { formatDateShort } from "@/shared/lib/date-format";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";
import { FaCaretDown, FaCheck } from "react-icons/fa6";

// ISR with tag-based purge: admin rate / promo edits bust the rate-config /
// active-promo tags, which invalidates this page immediately; the 5-minute
// window only limits how long a purely time-expired promo can linger.
export const revalidate = 300;

/**
 * Builds page metadata; reflects the active promo and live base/complex rates.
 * @returns Metadata object.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [promo, pricing] = await Promise.all([getActivePromo(), getPublicPricing()]);
  const rateBlurb = promo
    ? `Limited offer: ${summariseForBanner(promo)}.`
    : `$${pricing.baseRate}/hr for every job - no complex-work surcharge.`;
  return {
    title: promo
      ? `Pricing - ${summariseForBanner(promo)}`
      : `Pricing - $${pricing.baseRate}/hr Tech Support in Auckland`,
    description: `Transparent tech support pricing in Auckland. ${rateBlurb} No hidden fees, no upselling. On-site and remote rates available.`,
    alternates: { canonical: "/pricing" },
    openGraph: {
      title: "Pricing - To The Point Tech",
      description: `Simple, transparent rates. ${rateBlurb}`,
      url: "/pricing",
    },
  };
}

const linkStyle =
  "text-coquelicot-500 hover:text-coquelicot-600 underline-offset-4 hover:underline";

/**
 * Renders `**…**` segments from pricing-policy copy as `<strong>` spans.
 * @param text - Copy string containing zero or more `**…**` segments.
 * @returns Array of React nodes ready to drop into a `<div>`.
 */
function renderEmphasised(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
    const m = part.match(/^\*\*([^*]+)\*\*$/);
    return m ? <strong key={i}>{m[1]}</strong> : <span key={i}>{part}</span>;
  });
}

const ACCORDION_DETAILS =
  "group rounded-xl border border-seasalt-400/60 bg-seasalt-900/40 p-0 open:bg-white open:shadow-sm";
const ACCORDION_SUMMARY = cn(
  "flex cursor-pointer items-center justify-between gap-3 rounded-xl px-5 py-4 text-base font-semibold text-russian-violet sm:text-lg",
  "marker:hidden hover:bg-white/60",
  "[&::-webkit-details-marker]:hidden",
);
const ACCORDION_BODY =
  "text-rich-black/90 space-y-3 whitespace-pre-line px-5 pb-5 pt-1 text-base sm:text-lg";

/**
 * Pricing page; fetches live rates + the active promo server-side so a single
 * rate change in the admin UI propagates without a deploy.
 * @returns Pricing page element.
 */
export default async function PricingPage(): Promise<React.ReactElement> {
  const [promo, pricing, policy, settings] = await Promise.all([
    getActivePromo(),
    getPublicPricing(),
    getPolicy(),
    getSettings(),
  ]);
  const baseRate = pricing.baseRate;
  return (
    <PageShell>
      <PixelEvent event="ViewContent" />
      <BreadcrumbJsonLd
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Pricing", path: "/pricing" },
        ]}
      />
      <FrostedSection>
        <div className="flex flex-col gap-6 sm:gap-8">
          <section aria-labelledby="pricing-heading" className={cn(CARD, "animate-fade-in")}>
            <h1
              id="pricing-heading"
              className="mb-4 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl"
            >
              Pricing
            </h1>
            <p className="mb-4 text-base text-rich-black sm:text-lg">
              Simple, transparent pricing. You'll always know the cost before work begins, and
              there's no pressure to buy anything you don't need.
            </p>
          </section>

          <section
            aria-label="Rates"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}
          >
            <h2 className="mb-3 text-xl font-bold text-russian-violet sm:text-2xl">Rates</h2>

            {promo ? (
              <>
                <div className="rounded-lg border border-mustard-400 bg-mustard-900 p-5">
                  <p className="mb-1 text-lg text-rich-black/60 line-through sm:text-xl">
                    ${baseRate}/hr
                  </p>
                  <p className="mb-2 text-3xl font-bold text-russian-violet sm:text-4xl">
                    ${applyPromoToHourlyRate(baseRate, promo).toFixed(0)}/hr
                  </p>
                  <p className="text-base text-rich-black/80 sm:text-lg">
                    One rate for every job - troubleshooting, setup, software, tune-ups, Wi-Fi,
                    backups, data recovery, hardware repairs, and more.
                  </p>
                </div>

                <div className="mt-4 rounded-lg bg-mustard-500 px-4 py-3 text-center text-russian-violet-500">
                  <p className="text-base font-bold sm:text-lg">
                    ⚡ Limited offer: {promo.title}
                    {promo.description ? ` - ${promo.description}` : ""}
                  </p>
                  <p className="mt-1 text-base text-russian-violet-500 sm:text-lg">
                    Until {formatDateShort(promo.endAt)}.
                  </p>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-seasalt-400/60 bg-seasalt-900/40 p-5">
                <p className="mb-2 text-3xl font-bold text-russian-violet sm:text-4xl">
                  ${baseRate}/hr
                </p>
                <p className="text-base text-rich-black/80 sm:text-lg">
                  One rate for every job - troubleshooting, setup, software, tune-ups, Wi-Fi,
                  backups, data recovery, hardware repairs, and more.
                </p>
              </div>
            )}

            <GetEstimateButton />

            <div className="mt-5 space-y-3">
              <p className="flex gap-3 text-base text-rich-black/90 sm:text-lg">
                <FaCheck className="mt-1.5 h-4 w-4 shrink-0 text-moonstone-600" aria-hidden />
                <span>
                  <strong>Quick calls and emails are free.</strong> A "remote session" is when I log
                  in and start working on your machine.
                </span>
              </p>
              <p className="flex gap-3 text-base text-rich-black/90 sm:text-lg">
                <FaCheck className="mt-1.5 h-4 w-4 shrink-0 text-moonstone-600" aria-hidden />
                <span>
                  <strong>Most jobs take 1 to 2 hours.</strong> I'll give you a time estimate before
                  we start.
                </span>
              </p>
              <p className="flex gap-3 text-base text-rich-black/90 sm:text-lg">
                <FaCheck className="mt-1.5 h-4 w-4 shrink-0 text-moonstone-600" aria-hidden />
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
            <h2 className="mb-3 text-xl font-bold text-russian-violet sm:text-2xl">
              On-site vs Remote
            </h2>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className={cn(SOFT_CARD)}>
                <h3 className="mb-3 text-lg font-semibold text-russian-violet sm:text-xl">
                  On-site visits
                </h3>
                <ul className="space-y-2.5 text-base text-rich-black sm:text-lg">
                  <li className="flex gap-3">
                    <span className="mt-1 text-lg text-moonstone-600">•</span>
                    <span>Hourly rate (${baseRate}/hr)</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-1 text-lg text-moonstone-600">•</span>
                    <span>
                      <strong>One round trip</strong> billed at{" "}
                      <strong>${pricing.travelRatePerHour}/hr</strong> (lower than the hourly rate),{" "}
                      <strong>$10 minimum</strong>
                    </span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-1 text-lg text-moonstone-600">•</span>
                    <span>
                      Best for: Wi-Fi setup, printers, smart TVs, physical hardware, anything
                      needing hands-on work
                    </span>
                  </li>
                </ul>
              </div>

              <div className={cn(SOFT_CARD)}>
                <h3 className="mb-3 text-lg font-semibold text-russian-violet sm:text-xl">
                  Remote support
                </h3>
                <ul className="space-y-2.5 text-base text-rich-black sm:text-lg">
                  <li className="flex gap-3">
                    <span className="mt-1 text-lg text-moonstone-600">•</span>
                    <span>Discounted rate, no travel charge</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-1 text-lg text-moonstone-600">•</span>
                    <span>No drive time means quicker turnaround</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="mt-1 text-lg text-moonstone-600">•</span>
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
              className="mb-3 text-xl font-bold text-russian-violet sm:text-2xl"
            >
              No surprises
            </h2>

            <ul className="mb-5 space-y-2.5 text-base text-rich-black sm:text-lg">
              <li className="flex gap-3">
                <span className="mt-1 text-lg text-moonstone-600">•</span>
                <span>
                  <strong>No hidden fees.</strong> The price I quote is the price you pay.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-1 text-lg text-moonstone-600">•</span>
                <span>
                  <strong>No upselling.</strong> I don't sell hardware or earn commission on
                  products.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-1 text-lg text-moonstone-600">•</span>
                <span>
                  <strong>Clear communication.</strong> If a job is taking longer than expected,
                  I'll let you know before continuing.
                </span>
              </li>
            </ul>

            <h3 className="mb-3 text-lg font-bold text-russian-violet sm:text-xl">Full details</h3>
            <p className="mb-4 text-base text-rich-black/70 sm:text-lg">
              The fine print, in plain English. Click any section to expand.
            </p>

            <div className="space-y-3">
              <details className={ACCORDION_DETAILS}>
                <summary className={ACCORDION_SUMMARY}>
                  <span>Rate modifiers</span>
                  <FaCaretDown
                    className="h-4 w-4 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className={ACCORDION_BODY}>
                  <p>
                    The hourly rate is the starting point. These modifiers can stack on top
                    depending on the job:
                  </p>
                  <ul className="space-y-2">
                    {pricing.modifiers.map((mod) => (
                      <li key={mod.label} className="flex flex-col">
                        <span>
                          <strong>{mod.label}</strong> ({mod.deltaDescription} ={" "}
                          <strong>${mod.effectiveRate}/hr</strong>) - {mod.description}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>

              <details className={ACCORDION_DETAILS}>
                <summary className={ACCORDION_SUMMARY}>
                  <span>Travel</span>
                  <FaCaretDown
                    className="h-4 w-4 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className={ACCORDION_BODY}>
                  {renderEmphasised(
                    travelCopy(pricing.travelRatePerHour, policy.MIN_TRAVEL_CHARGE),
                  )}
                </div>
              </details>

              <details className={ACCORDION_DETAILS}>
                <summary className={ACCORDION_SUMMARY}>
                  <span>Minimum charge</span>
                  <FaCaretDown
                    className="h-4 w-4 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className={ACCORDION_BODY}>
                  {renderEmphasised(
                    minimumsCopy(policy.MIN_BILLABLE_MINS, policy.BILLING_INCREMENT_MINS),
                  )}
                </div>
              </details>

              <details className={ACCORDION_DETAILS}>
                <summary className={ACCORDION_SUMMARY}>
                  <span>Cancellation</span>
                  <FaCaretDown
                    className="h-4 w-4 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className={ACCORDION_BODY}>
                  {renderEmphasised(cancellationCopy(policy.CANCELLATION))}
                </div>
              </details>

              <details className={ACCORDION_DETAILS}>
                <summary className={ACCORDION_SUMMARY}>
                  <span>Unsuccessful work</span>
                  <FaCaretDown
                    className="h-4 w-4 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className={ACCORDION_BODY}>
                  {renderEmphasised(unsuccessfulWorkCopy(policy.UNSUCCESSFUL_WORK_FACTOR))}
                </div>
              </details>

              <details className={ACCORDION_DETAILS}>
                <summary className={ACCORDION_SUMMARY}>
                  <span>Public holidays</span>
                  <FaCaretDown
                    className="h-4 w-4 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className={ACCORDION_BODY}>
                  {renderEmphasised(publicHolidayCopy(policy.PUBLIC_HOLIDAY_UPLIFT))}
                </div>
              </details>

              <details className={ACCORDION_DETAILS}>
                <summary className={ACCORDION_SUMMARY}>
                  <span>GST</span>
                  <FaCaretDown
                    className="h-4 w-4 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </summary>
                <div className={ACCORDION_BODY}>
                  {renderEmphasised(gstCopy(policy.GST_REGISTERED))}
                </div>
              </details>
            </div>
          </section>

          <section
            aria-label="Next steps"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-400")}
          >
            <p className="text-base text-rich-black sm:text-lg">
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
              className="mb-1 scroll-mt-24 text-xl font-bold text-russian-violet sm:text-2xl"
            >
              Get a rough estimate
            </h2>
            <p className="mb-5 text-base text-rich-black/70 sm:text-lg">
              Answer a few quick questions to get a price range. No commitment required.
            </p>
            <PricingWizard
              minBillableMins={policy.MIN_BILLABLE_MINS}
              minTravelCharge={policy.MIN_TRAVEL_CHARGE}
              estimatorRange={settings.estimator.range}
              lowEndFloorFactor={settings.estimator.lowEndFloorFactor}
            />
          </section>

          {pricing.ratesUpdatedAt && (
            <p className="text-center text-sm text-rich-black/50 sm:text-base">
              Rates last updated on {formatDateShort(pricing.ratesUpdatedAt)}.
            </p>
          )}
        </div>
      </FrostedSection>
    </PageShell>
  );
}
