// src/app/pricing/page.tsx
// Pricing page. Live rates; accordion copy from pricing-policy.ts so it matches the
// booking emails and FAQ.

import { GetEstimateButton } from "@/features/business/components/GetEstimateButton";
import { PricingWizard } from "@/features/business/components/PricingWizard";
import { formatMoneyCompact } from "@/features/business/lib/business";
import {
  cancellationCopy,
  gstCopy,
  minimumsCopy,
  partsCopy,
  publicHolidayCopy,
  travelCopy,
  unsuccessfulWorkCopy,
  weekendCopy,
  workmanshipCopy,
} from "@/features/business/lib/pricing-policy";
import { getPolicy, getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import {
  describePromoOffer,
  describeRecurringWindow,
  getActivePromo,
  hasActivePromoCode,
  promoDisplayRate,
  promoForRateCard,
  promoLastDay,
  promoModifierRate,
  promoRateBeforeAfter,
  promoTravelBeforeAfter,
  promoTravelFactor,
  summariseForBanner,
} from "@/features/business/lib/promos";
import { ClosingCta } from "@/shared/components/ClosingCta";
import { Disclosure } from "@/shared/components/Disclosure";
import { Notice } from "@/shared/components/Notice";
import { PageHead } from "@/shared/components/PageHead";
import { PageShell } from "@/shared/components/PageLayout";
import { PixelEvent } from "@/shared/components/PixelEvent";
import { PromoPrice } from "@/shared/components/PromoPrice";
import { RuledBlock, RuledGrid } from "@/shared/components/RuledGrid";
import { Section, SectionHeading, TEXT_LINK } from "@/shared/components/Section";
import { TickItem, TickList } from "@/shared/components/TickList";
import { renderEmphasised } from "@/shared/components/renderEmphasised";
import { formatDateShort } from "@/shared/lib/date-format";
import { roundCents } from "@/shared/lib/money";
import { pageOpenGraph } from "@/shared/lib/open-graph";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";

// Rate/promo edits purge via cache tags, and the publish cron busts active-promo within
// ~5 min of a promo starting or ending. The daily timer is a fallback.
export const revalidate = 86400;

/**
 * Builds page metadata; reflects the active promo and live base/complex rates.
 * @returns Metadata object.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [promo, pricing] = await Promise.all([getActivePromo(), getPublicPricing()]);
  // Fixed end date: search results outlive a relative "this Friday".
  const promoSummary = promo ? summariseForBanner(promo, { fixedDate: true }) : null;
  const rateBlurb = promoSummary
    ? `Limited offer: ${promoSummary}.`
    : `$${pricing.baseRate}/hr for every job - no complex-work surcharge.`;
  // A promo title drops the brand suffix so the offer fits Google's ~60-char cut.
  const title = promoSummary
    ? `Computer Repair Prices Auckland - ${promoSummary}`
    : `Computer Repair Prices Auckland - ${pricing.baseRate}/hr`;
  const description = `Computer repair and tech support prices in Auckland. ${rateBlurb} No hidden fees, no upselling.`;
  return {
    title: promoSummary ? { absolute: title } : title,
    description,
    alternates: { canonical: "/pricing" },
    openGraph: pageOpenGraph({
      title,
      description,
      url: "/pricing",
      absoluteTitle: !!promoSummary,
    }),
  };
}

/**
 * Pricing page with live rates and the active promo.
 * @returns Pricing page element.
 */
export default async function PricingPage(): Promise<React.ReactElement> {
  // A failed promo lookup shows the code box rather than hiding a code that works.
  const [promo, pricing, policy, settings, showPromoCode] = await Promise.all([
    getActivePromo(),
    getPublicPricing(),
    getPolicy(),
    getSettings(),
    hasActivePromoCode().catch(() => true),
  ]);
  const baseRate = pricing.baseRate;
  // `promo` announces the offer; `pricedPromo` is null when a weekday/time restriction or
  // spend floor can't be checked here (no slot or job yet), so figures stay undiscounted.
  const pricedPromo = promoForRateCard(promo);
  const promoRestriction = promo ? describeRecurringWindow(promo) : null;
  // Crossed-out pairs; null when the promo doesn't touch that figure.
  const ratePair = pricedPromo ? promoRateBeforeAfter(baseRate, pricedPromo) : null;
  const travelPair = pricedPromo
    ? promoTravelBeforeAfter(pricing.travelRatePerHour, pricedPromo)
    : null;
  // Every other price quotes these, so the page never contradicts the promo.
  const displayRate = promoDisplayRate(baseRate, pricedPromo);
  const travelFactor = promoTravelFactor(pricedPromo);
  const displayTravelRate = roundCents(pricing.travelRatePerHour * travelFactor);
  const displayMinTravel = roundCents(policy.MIN_TRAVEL_CHARGE * travelFactor);
  const rateDiscounted = displayRate !== baseRate;
  const travelDiscounted = travelFactor < 1;
  const { identity } = settings;
  return (
    <PageShell>
      <PixelEvent event="ViewContent" />
      <PageHead
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Pricing", path: "/pricing" },
        ]}
        title="Pricing"
        intro="Simple, transparent pricing. You'll always know the cost before work begins, and there's no pressure to buy anything you don't need."
        action={<GetEstimateButton />}
      />

      <Section aria-labelledby="home-rates-heading">
        {/* "Home", so business visitors don't take this rate as theirs. */}
        <SectionHeading id="home-rates-heading" title="Home rates" />

        <div className="max-w-180">
          {promo ? (
            <>
              <div className="rounded-lg border-2 border-mustard-300 bg-mustard-50 p-6">
                {/* Labour promos (fixed amounts too, see promoRateBeforeAfter) move this;
                    travel promos cross out the travel charge instead. */}
                {ratePair && (
                  <p className="mb-1 text-lg text-seasalt-700 line-through sm:text-xl">
                    {formatMoneyCompact(ratePair.before)}/hr
                  </p>
                )}
                <p className="mb-2 text-3xl font-bold text-russian-violet sm:text-4xl">
                  {formatMoneyCompact(ratePair?.after ?? baseRate)}/hr
                </p>
                {travelPair && (
                  <p className="mb-2 text-lg font-semibold text-russian-violet sm:text-xl">
                    Travel{" "}
                    <span className="text-seasalt-700 line-through">
                      {formatMoneyCompact(travelPair.before)}/hr
                    </span>{" "}
                    {formatMoneyCompact(travelPair.after)}/hr
                  </p>
                )}
                <p className="text-base text-rich-black sm:text-lg">
                  One rate for every home job - troubleshooting, setup, software, tune-ups, Wi-Fi,
                  backups, data recovery, hardware repairs, and more.
                </p>
              </div>

              <div className="mt-4 rounded-lg bg-mustard-300 px-4 py-3 text-center text-russian-violet-900">
                <p className="text-base font-bold sm:text-lg">
                  ⚡ Limited offer: {promo.title}
                  {promo.description ? ` - ${promo.description}` : ""}
                </p>
                {/* The pair shows the result, not the terms ("$65 to $55.25" isn't "15% off"). */}
                <p className="mt-1 text-base font-semibold sm:text-lg">
                  {describePromoOffer(promo)}
                </p>
                {/* Explains why the rate above hasn't moved for a restricted promo. */}
                {promoRestriction && (
                  <p className="mt-1 text-base font-semibold sm:text-lg">{promoRestriction} only</p>
                )}
                <p className="mt-1 text-base text-russian-violet-900 sm:text-lg">
                  Until {formatDateShort(promoLastDay(promo.endAt))}.
                </p>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-seasalt-100 p-6">
              <p className="mb-2 text-3xl font-bold text-russian-violet sm:text-4xl">
                ${baseRate}/hr
              </p>
              <p className="text-base text-rich-black sm:text-lg">
                One rate for every home job - troubleshooting, setup, software, tune-ups, Wi-Fi,
                backups, data recovery, hardware repairs, and more.
              </p>
            </div>
          )}

          {/* Beside the rate, not in the caveats, where it reads as skippable fine print. */}
          <Notice className="mt-5">
            <strong>Running a business?</strong> Check out the business rates and monthly retainers
            on the{" "}
            <Link href="/business" className={TEXT_LINK}>
              business page
            </Link>
            .
          </Notice>

          <TickList className="mt-5">
            <TickItem>
              <strong>Quick calls and emails are free.</strong> A "remote session" is when I log in
              and start working on your machine.
            </TickItem>
            <TickItem>
              <strong>Most jobs take 1 to 2 hours.</strong> I'll give you a time estimate before we
              start.
            </TickItem>
            <TickItem>
              <strong>Not sure which rate applies?</strong> Just ask - I'll confirm before starting.
            </TickItem>
          </TickList>
        </div>
      </Section>

      <Section tone="grey" aria-labelledby="how-pricing-works-heading">
        <SectionHeading id="how-pricing-works-heading" title="On-site vs Remote" />
        <RuledGrid cols={2}>
          <RuledBlock title="On-site visits">
            <TickList className="gap-2.5">
              <TickItem variant="dot">
                Hourly rate (
                <PromoPrice discounted={rateDiscounted}>
                  {formatMoneyCompact(displayRate)}/hr
                </PromoPrice>
                )
              </TickItem>
              <TickItem variant="dot">
                <strong>One round trip</strong> billed at{" "}
                <PromoPrice discounted={travelDiscounted} className="font-bold">
                  {formatMoneyCompact(displayTravelRate)}/hr
                </PromoPrice>{" "}
                (lower than the hourly rate),{" "}
                {/* Read from settings, not hardcoded: the minimum is configurable. */}
                <PromoPrice discounted={travelDiscounted} className="font-bold">
                  {formatMoneyCompact(displayMinTravel)} minimum
                </PromoPrice>
              </TickItem>
              <TickItem variant="dot">
                Best for: Wi-Fi setup, printers, smart TVs, physical hardware, anything needing
                hands-on work
              </TickItem>
            </TickList>
          </RuledBlock>

          <RuledBlock title="Remote support">
            <TickList className="gap-2.5">
              <TickItem variant="dot">Discounted rate, no travel charge</TickItem>
              <TickItem variant="dot">No drive time means quicker turnaround</TickItem>
              <TickItem variant="dot">
                Best for: account issues, software setup, email problems, quick fixes, follow-up
                support
              </TickItem>
            </TickList>
          </RuledBlock>
        </RuledGrid>
      </Section>

      <Section aria-labelledby="no-surprises-heading">
        <SectionHeading id="no-surprises-heading" title="No surprises" />

        <TickList className="mb-8">
          <TickItem>
            <strong>No hidden fees.</strong> The price I quote is the price you pay.
          </TickItem>
          <TickItem>
            <strong>No upselling.</strong> I don't sell hardware or earn commission on products.
          </TickItem>
          <TickItem>
            <strong>Clear communication.</strong> If a job is taking longer than expected, I'll let
            you know before continuing.
          </TickItem>
        </TickList>

        <h3 className="mb-3 text-xl font-bold">Full details</h3>
        <p className="mb-4 text-seasalt-700">
          The fine print, in plain English. Tap or click any section to open it.
        </p>

        <div className="max-w-180">
          <Disclosure title="Rate modifiers" bodyClassName="whitespace-pre-line">
            <p>
              The hourly rate is the starting point. These modifiers can stack on top depending on
              the job:
            </p>
            <ul className="space-y-2">
              {pricing.modifiers.map((mod) => (
                <li key={mod.label} className="flex flex-col">
                  <span>
                    <strong>{mod.label}</strong> ({mod.deltaDescription} ={" "}
                    <PromoPrice
                      discounted={
                        promoModifierRate(baseRate, mod.effectiveRate, mod.kind, pricedPromo) !==
                        mod.effectiveRate
                      }
                      className="font-bold"
                    >
                      {formatMoneyCompact(
                        promoModifierRate(baseRate, mod.effectiveRate, mod.kind, pricedPromo),
                      )}
                      /hr
                    </PromoPrice>
                    ) - {mod.description}
                  </span>
                </li>
              ))}
            </ul>
          </Disclosure>

          <Disclosure title="Travel" bodyClassName="whitespace-pre-line">
            {renderEmphasised(travelCopy(displayTravelRate, displayMinTravel))}
          </Disclosure>

          <Disclosure title="Minimum charge" bodyClassName="whitespace-pre-line">
            {renderEmphasised(
              minimumsCopy(policy.MIN_BILLABLE_MINS, policy.BILLING_INCREMENT_MINS),
            )}
          </Disclosure>

          <Disclosure title="Parts" bodyClassName="whitespace-pre-line">
            {renderEmphasised(partsCopy())}
          </Disclosure>

          <Disclosure title="Cancellation" bodyClassName="whitespace-pre-line">
            {renderEmphasised(cancellationCopy(policy.CANCELLATION))}
          </Disclosure>

          <Disclosure title="Unsuccessful work" bodyClassName="whitespace-pre-line">
            {renderEmphasised(
              unsuccessfulWorkCopy(policy.UNSUCCESSFUL_WORK_FACTOR, policy.NO_FIX_FREE_MINS),
            )}
          </Disclosure>

          {/* A 0-day window means no stated guarantee, so the section is hidden. */}
          {policy.WORKMANSHIP_WINDOW_DAYS > 0 && (
            <Disclosure title="Workmanship guarantee" bodyClassName="whitespace-pre-line">
              {renderEmphasised(workmanshipCopy(policy.WORKMANSHIP_WINDOW_DAYS))}
            </Disclosure>
          )}

          <Disclosure
            title={policy.WEEKEND_UPLIFT > 0 ? "Weekends and public holidays" : "Public holidays"}
            bodyClassName="whitespace-pre-line"
          >
            {policy.WEEKEND_UPLIFT > 0 && (
              <p>{renderEmphasised(weekendCopy(policy.WEEKEND_UPLIFT))}</p>
            )}
            <p>{renderEmphasised(publicHolidayCopy(policy.PUBLIC_HOLIDAY_UPLIFT))}</p>
          </Disclosure>

          <Disclosure title="GST" bodyClassName="whitespace-pre-line">
            {renderEmphasised(gstCopy(policy.GST_REGISTERED))}
          </Disclosure>
        </div>
      </Section>

      {/* The id is the scroll target of GetEstimateButton; Section adds the scroll margin. */}
      <Section tone="grey" id="estimate" aria-labelledby="estimate-heading">
        <SectionHeading
          id="estimate-heading"
          title="Get a rough estimate"
          lead="Answer a few quick questions to get a price range. No commitment required."
        />
        <PricingWizard
          minBillableMins={policy.MIN_BILLABLE_MINS}
          minTravelCharge={policy.MIN_TRAVEL_CHARGE}
          travelRatePerHour={policy.TRAVEL_RATE_PER_HOUR}
          estimatorRange={settings.estimator.range}
          lowEndFloorFactor={settings.estimator.lowEndFloorFactor}
          showPromoCode={showPromoCode}
        />
        {pricing.ratesUpdatedAt && (
          <p className="mt-6 text-sm text-seasalt-700">
            Rates last updated on {formatDateShort(pricing.ratesUpdatedAt)}.
          </p>
        )}
      </Section>

      <ClosingCta
        title="Ready to book?"
        line="Book online, or call or text if you'd rather talk it through first."
        phone={identity.phone}
        phoneTel={identity.phoneTel}
      />
    </PageShell>
  );
}
