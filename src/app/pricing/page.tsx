// src/app/pricing/page.tsx
// Pricing page: every live rate and out-of-hours charge as ruled blocks, the estimate, then
// the fine print. Copy comes from pricing-policy.ts so it matches the booking emails and FAQ.

import { hourLabel } from "@/features/booking/lib/booking";
import { GetEstimateButton } from "@/features/business/components/GetEstimateButton";
import { PricingWizard } from "@/features/business/components/PricingWizard";
import { formatMoneyCompact, goldCardOffText } from "@/features/business/lib/business";
import {
  cancellationCopy,
  minimumsCopy,
  travelCopy,
  unsuccessfulWorkCopy,
  workmanshipCopy,
} from "@/features/business/lib/pricing-policy";
import {
  getPolicy,
  getPublicPricing,
  getRateRows,
  toPublicRates,
} from "@/features/business/lib/pricing-policy.server";
import {
  describePromoOffer,
  describeRecurringWindow,
  getActivePromo,
  hasActivePromoCode,
  promoDisplayRate,
  promoForRateCard,
  promoLastDay,
  promoModifierRate,
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

/** One rate or out-of-hours charge on the price grid. */
interface PriceLine {
  key: string;
  name: string;
  note: React.ReactNode;
  /** The figure a promo crosses out, or null when nothing is crossed out. */
  before: number | null;
  /** The figure shown, e.g. 65 for "$65/hr" or 10 for "+$10/hr". */
  price: number;
  /** "+$10/hr" for a surcharge, "$65/hr" for a rate. */
  surcharge?: boolean;
}

/**
 * One price as a ruled block: the name, the figure (after the crossed-out original when a
 * promo moved it), then what it covers.
 * @param props - Component props.
 * @param props.line - The price to show.
 * @returns The block element.
 */
function PriceBlock({ line }: { line: PriceLine }): React.ReactElement {
  return (
    <RuledBlock title={line.name}>
      <p className="mb-1 text-2xl font-extrabold">
        {line.before !== null && (
          <s className="mr-2 text-lg font-semibold text-seasalt-700">
            {formatMoneyCompact(line.before)}/hr
          </s>
        )}
        <PromoPrice discounted={line.before !== null} className="font-extrabold">
          {line.surcharge && "+"}
          {formatMoneyCompact(line.price)}/hr
        </PromoPrice>
      </p>
      <p className="text-pretty text-seasalt-700">{line.note}</p>
    </RuledBlock>
  );
}

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
    : `Computer Repair Prices Auckland - $${pricing.baseRate}/hr`;
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
  const [promo, pricing, policy, settings, showPromoCode, rateRows] = await Promise.all([
    getActivePromo(),
    getPublicPricing(),
    getPolicy(),
    getSettings(),
    hasActivePromoCode().catch(() => true),
    getRateRows(),
  ]);
  const baseRate = pricing.baseRate;
  // `promo` announces the offer; `pricedPromo` is null when a weekday/time restriction or
  // spend floor can't be checked here (no slot or job yet), so figures stay undiscounted.
  const pricedPromo = promoForRateCard(promo);
  const promoRestriction = promo ? describeRecurringWindow(promo) : null;
  // Every price below quotes these, so the page never contradicts the promo.
  const displayRate = promoDisplayRate(baseRate, pricedPromo);
  const travelFactor = promoTravelFactor(pricedPromo);
  const displayTravelRate = roundCents(pricing.travelRatePerHour * travelFactor);
  const displayMinTravel = roundCents(policy.MIN_TRAVEL_CHARGE * travelFactor);
  const travelDiscounted = travelFactor < 1;

  // On-site first, then each public channel dearest first. A flat promo prices a channel at
  // the gap it locked in, which promoModifierRate reads by label.
  const channelLines = pricing.modifiers
    .filter((mod) => mod.kind === "delta")
    .map((mod): PriceLine => {
      const price = promoModifierRate(
        baseRate,
        mod.effectiveRate,
        mod.kind,
        pricedPromo,
        mod.label,
      );
      return {
        key: mod.label,
        name: mod.publicLabel,
        note: mod.description,
        before: price !== mod.effectiveRate ? mod.effectiveRate : null,
        price,
      };
    })
    .sort((a, b) => b.price - a.price);
  const rateLines: PriceLine[] = [
    {
      key: "on-site",
      name: "At your place",
      note: (
        <>
          Anything hands-on, like Wi-Fi, printers, TVs and new devices. Plus travel: one round trip
          at{" "}
          <PromoPrice discounted={travelDiscounted}>
            {formatMoneyCompact(displayTravelRate)}/hr
          </PromoPrice>
          , {/* Read from settings, not hardcoded: the minimum is configurable. */}
          <PromoPrice discounted={travelDiscounted}>
            {formatMoneyCompact(displayMinTravel)} minimum
          </PromoPrice>
          .
        </>
      ),
      before: displayRate !== baseRate ? baseRate : null,
      price: displayRate,
    },
    ...channelLines,
  ];

  // Flat $/hr on every rate, which no promo discounts. After hours bills the weekend amount,
  // so evenings show only while that is on; a $0 surcharge is off and gets no line.
  const eveningFrom = policy.WEEKEND_PER_HOUR > 0 ? policy.AFTER_HOURS_FROM_HOUR : null;
  const surchargeLines: PriceLine[] = [];
  if (policy.WEEKEND_PER_HOUR > 0) {
    surchargeLines.push({
      key: "weekend",
      name:
        eveningFrom === null ? "Weekends" : `Evenings from ${hourLabel(eveningFrom)} and weekends`,
      note:
        eveningFrom === null
          ? "All day Saturday and Sunday."
          : `Weekday visits starting from ${hourLabel(eveningFrom)}, and all day Saturday and Sunday. To book an evening online, tick Show evening times.`,
      before: null,
      price: policy.WEEKEND_PER_HOUR,
      surcharge: true,
    });
  }
  if (policy.PUBLIC_HOLIDAY_PER_HOUR > 0) {
    surchargeLines.push({
      key: "holiday",
      name: "Public holidays",
      note: "Christmas Eve and New Year's Eve count too. Never on top of the weekend extra.",
      before: null,
      price: policy.PUBLIC_HOLIDAY_PER_HOUR,
      surcharge: true,
    });
  }
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
        {/* "Home", so business visitors don't take these rates as theirs. */}
        <SectionHeading
          id="home-rates-heading"
          title="Home rates"
          lead="You only pay for the time the job takes."
        />
        <RuledGrid cols={3}>
          {rateLines.map((line) => (
            <PriceBlock key={line.key} line={line} />
          ))}
        </RuledGrid>

        <div className="mt-9 max-w-180">
          {promo && (
            // The Notice shape in the promo banner's mustard, so the offer reads as part of the page.
            <div className="mb-8 border-l-4 border-mustard-500 bg-mustard-100 px-5 py-4 text-russian-violet-900">
              <p className="font-bold">
                Limited offer: {promo.title}
                {promo.description ? ` - ${promo.description}` : ""}
              </p>
              {/* The pair shows the result, not the terms ("$65 to $55.25" isn't "15% off"). */}
              <p className="mt-1 font-semibold">{describePromoOffer(promo)}</p>
              {/* Explains why the prices above haven't moved for a restricted promo. */}
              {promoRestriction && <p className="mt-1 font-semibold">{promoRestriction} only</p>}
              <p className="mt-1">
                Book by {formatDateShort(promoLastDay(promo.endAt))}. Your visit can be after that.
              </p>
            </div>
          )}

          <TickList>
            <TickItem>
              <strong>Parts at cost, no markup.</strong> You approve the price first.{" "}
              {policy.GST_REGISTERED ? "Prices include GST." : "Not GST registered."}
            </TickItem>
            {pricing.goldCardPercent !== null && (
              <TickItem>
                <strong>SuperGold Card? {goldCardOffText(pricing.goldCardPercent)}.</strong> Just
                mention it when you book.
              </TickItem>
            )}
            <TickItem>
              <strong>Most jobs take 1 to 2 hours.</strong> I'll give you a time estimate before we
              start.
            </TickItem>
            <TickItem>
              <strong>Not sure which rate applies?</strong> Just ask - I'll confirm before starting.
            </TickItem>
          </TickList>

          {/* Beside the rates, not in the caveats, where it reads as skippable fine print. */}
          <Notice className="mt-8">
            <strong>Running a business?</strong> Check out the business rates and monthly retainers
            on the{" "}
            <Link href="/business" className={TEXT_LINK}>
              business page
            </Link>
            .
          </Notice>
        </div>
      </Section>

      {surchargeLines.length > 0 && (
        <Section tone="grey" aria-labelledby="out-of-hours-heading">
          <SectionHeading
            id="out-of-hours-heading"
            title="Out-of-hours rates"
            lead="Labour costs this much more per hour on any rate above. Travel and parts stay the same."
          />
          <RuledGrid cols={3}>
            {surchargeLines.map((line) => (
              <PriceBlock key={line.key} line={line} />
            ))}
          </RuledGrid>
        </Section>
      )}

      {/* The id is the scroll target of GetEstimateButton; Section adds the scroll margin. */}
      <Section id="estimate" aria-labelledby="estimate-heading">
        <SectionHeading
          id="estimate-heading"
          title="Get a rough estimate"
          lead="Answer a few quick questions to get a price range. No commitment required."
        />
        <PricingWizard
          baseRate={baseRate}
          rates={toPublicRates(rateRows)}
          weekendPerHour={policy.WEEKEND_PER_HOUR}
          publicHolidayPerHour={policy.PUBLIC_HOLIDAY_PER_HOUR}
          afterHoursFromHour={policy.AFTER_HOURS_FROM_HOUR}
          minBillableMins={policy.MIN_BILLABLE_MINS}
          minTravelCharge={policy.MIN_TRAVEL_CHARGE}
          travelRatePerHour={policy.TRAVEL_RATE_PER_HOUR}
          estimatorRange={settings.estimator.range}
          lowEndFloorFactor={settings.estimator.lowEndFloorFactor}
          showPromoCode={showPromoCode}
        />
      </Section>

      <Section tone="grey" aria-labelledby="no-surprises-heading">
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

        <h3 className="mb-3 text-xl font-extrabold">Full details</h3>
        <p className="mb-4 text-seasalt-700">
          The fine print, in plain English. Tap or click any section to open it.
        </p>

        <div className="max-w-180">
          <Disclosure title="Travel" bodyClassName="whitespace-pre-line">
            {renderEmphasised(travelCopy(displayTravelRate, displayMinTravel))}
          </Disclosure>

          <Disclosure title="Minimum charge" bodyClassName="whitespace-pre-line">
            {renderEmphasised(
              minimumsCopy(policy.MIN_BILLABLE_MINS, policy.BILLING_INCREMENT_MINS),
            )}
          </Disclosure>

          <Disclosure title="Cancellation" bodyClassName="whitespace-pre-line">
            {renderEmphasised(cancellationCopy(policy.CANCELLATION))}
          </Disclosure>

          <Disclosure title="If I can't fix it" bodyClassName="whitespace-pre-line">
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
        </div>
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
