// src/app/pricing/page.tsx
// Pricing page. Rates come from RateConfig (shared with the calculator and wizard);
// accordion copy comes from pricing-policy.ts so the page, booking emails, and FAQ stay
// aligned.

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
  workmanshipCopy,
} from "@/features/business/lib/pricing-policy";
import { getPolicy, getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import {
  describePromoOffer,
  describeRecurringWindow,
  getActivePromo,
  promoDisplayRate,
  promoForRateCard,
  promoModifierRate,
  promoRateBeforeAfter,
  promoTravelBeforeAfter,
  promoTravelFactor,
  summariseForBanner,
} from "@/features/business/lib/promos";
import { ClosingCta } from "@/shared/components/ClosingCta";
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
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";
import { FaCaretDown } from "react-icons/fa6";

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
    // A promo title drops the brand suffix so the offer fits Google's ~60-char cut.
    title: promo
      ? { absolute: `Computer Repair Prices Auckland - ${summariseForBanner(promo)}` }
      : `Computer Repair Prices Auckland - $${pricing.baseRate}/hr`,
    description: `Computer repair and tech support prices in Auckland. ${rateBlurb} No hidden fees, no upselling.`,
    alternates: { canonical: "/pricing" },
    openGraph: {
      title: "Pricing - To the Point Tech",
      description: `Simple, transparent rates. ${rateBlurb}`,
      url: "/pricing",
    },
  };
}

// Accordion row, summary and body classes for the "Full details" rows. Rows share the border,
// padding and focus ring of the Business and FAQ page accordions.
const ACCORDION_DETAILS = "group border-b border-seasalt-100 first:border-t";
const ACCORDION_SUMMARY =
  "flex cursor-pointer list-none items-center justify-between gap-4 rounded py-4 text-lg font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-russian-violet [&::-webkit-details-marker]:hidden";
const ACCORDION_BODY = "space-y-3 pb-5 text-base whitespace-pre-line text-rich-black";
const CHEVRON = "h-4 w-4 shrink-0 text-moonstone-700 transition-[rotate] group-open:rotate-180";

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
  // Words and numbers part company here. `promo` still announces the offer and
  // names its restriction; `pricedPromo` is null for a promo whose weekday or
  // time-of-day restriction or spend floor this page cannot check, because
  // nobody has picked an appointment or priced a job yet. Quoting a Tuesday
  // discount to someone who has not chosen a day, or a $100-minimum discount
  // as an hourly rate, promises a price the invoice will not honour.
  const pricedPromo = promoForRateCard(promo);
  // Named wherever the promo is announced, since the figures on this page stay
  // undiscounted for it.
  const promoRestriction = promo ? describeRecurringWindow(promo) : null;
  // Crossed-out pairs for the promo block. Null when the promo does not touch
  // that figure, so nothing is struck out to show the same number back.
  const ratePair = pricedPromo ? promoRateBeforeAfter(baseRate, pricedPromo) : null;
  const travelPair = pricedPromo
    ? promoTravelBeforeAfter(pricing.travelRatePerHour, pricedPromo)
    : null;
  // Every other price on the page quotes these rather than the raw settings, so
  // a live promo is not announced in the hero and then contradicted further
  // down by the standard rates.
  const displayRate = promoDisplayRate(baseRate, pricedPromo);
  const travelFactor = promoTravelFactor(pricedPromo);
  const displayTravelRate = Math.round(pricing.travelRatePerHour * travelFactor * 100) / 100;
  const displayMinTravel = Math.round(policy.MIN_TRAVEL_CHARGE * travelFactor * 100) / 100;
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
        {/* Qualified rather than just "Rates": an unqualified heading reads as
            universal, so a business visitor takes the home rate as theirs and
            never reaches the business page. */}
        <SectionHeading id="home-rates-heading" title="Home rates" />

        <div className="max-w-180">
          {promo ? (
            <>
              <div className="rounded-lg border-2 border-mustard-300 bg-mustard-50 p-6">
                {/* Every promo that saves money on labour moves this number,
                    including a fixed amount - see promoRateBeforeAfter for
                    what that figure means. A travel promo leaves it alone and
                    crosses out the travel charge below instead. */}
                {ratePair && (
                  <p className="mb-1 text-lg text-rich-black/60 line-through sm:text-xl">
                    {formatMoneyCompact(ratePair.before)}/hr
                  </p>
                )}
                <p className="mb-2 text-3xl font-bold text-russian-violet sm:text-4xl">
                  {formatMoneyCompact(ratePair?.after ?? baseRate)}/hr
                </p>
                {travelPair && (
                  <p className="mb-2 text-lg font-semibold text-russian-violet sm:text-xl">
                    Travel{" "}
                    <span className="text-rich-black/60 line-through">
                      {formatMoneyCompact(travelPair.before)}/hr
                    </span>{" "}
                    {formatMoneyCompact(travelPair.after)}/hr
                  </p>
                )}
                <p className="text-base text-rich-black/80 sm:text-lg">
                  One rate for every home job - troubleshooting, setup, software, tune-ups, Wi-Fi,
                  backups, data recovery, hardware repairs, and more.
                </p>
              </div>

              <div className="mt-4 rounded-lg bg-mustard-300 px-4 py-3 text-center text-russian-violet-900">
                <p className="text-base font-bold sm:text-lg">
                  ⚡ Limited offer: {promo.title}
                  {promo.description ? ` - ${promo.description}` : ""}
                </p>
                {/* Always: the crossed-out pair shows the result, not the
                    terms. "$65 to $55.25" does not tell anyone it is 15% off,
                    and for a fixed amount the pair is only a one-hour
                    illustration. */}
                <p className="mt-1 text-base font-semibold sm:text-lg">
                  {describePromoOffer(promo)}
                </p>
                {/* Without this a restricted promo reads as a discount that
                    applies now, beside a headline rate that has not moved.
                    The rates above are deliberately undiscounted, because no
                    appointment exists here to check the restriction against. */}
                {promoRestriction && (
                  <p className="mt-1 text-base font-semibold sm:text-lg">{promoRestriction} only</p>
                )}
                <p className="mt-1 text-base text-russian-violet-900 sm:text-lg">
                  Until {formatDateShort(promo.endAt)}.
                </p>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-seasalt-100 p-6">
              <p className="mb-2 text-3xl font-bold text-russian-violet sm:text-4xl">
                ${baseRate}/hr
              </p>
              <p className="text-base text-rich-black/80 sm:text-lg">
                One rate for every home job - troubleshooting, setup, software, tune-ups, Wi-Fi,
                backups, data recovery, hardware repairs, and more.
              </p>
            </div>
          )}

          {/* Sits with the rate rather than in the caveat list below: a business
              visitor forms their price impression here, and a fourth checkmark
              among the home-job caveats reads as fine print they can skip. */}
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
          The fine print, in plain English. Click any section to expand.
        </p>

        <div className="max-w-180">
          <details className={ACCORDION_DETAILS}>
            <summary className={ACCORDION_SUMMARY}>
              <span>Rate modifiers</span>
              <FaCaretDown className={CHEVRON} aria-hidden />
            </summary>
            <div className={ACCORDION_BODY}>
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
            </div>
          </details>

          <details className={ACCORDION_DETAILS}>
            <summary className={ACCORDION_SUMMARY}>
              <span>Travel</span>
              <FaCaretDown className={CHEVRON} aria-hidden />
            </summary>
            <div className={ACCORDION_BODY}>
              {renderEmphasised(travelCopy(displayTravelRate, displayMinTravel))}
            </div>
          </details>

          <details className={ACCORDION_DETAILS}>
            <summary className={ACCORDION_SUMMARY}>
              <span>Minimum charge</span>
              <FaCaretDown className={CHEVRON} aria-hidden />
            </summary>
            <div className={ACCORDION_BODY}>
              {renderEmphasised(
                minimumsCopy(policy.MIN_BILLABLE_MINS, policy.BILLING_INCREMENT_MINS),
              )}
            </div>
          </details>

          <details className={ACCORDION_DETAILS}>
            <summary className={ACCORDION_SUMMARY}>
              <span>Parts</span>
              <FaCaretDown className={CHEVRON} aria-hidden />
            </summary>
            <div className={ACCORDION_BODY}>{renderEmphasised(partsCopy())}</div>
          </details>

          <details className={ACCORDION_DETAILS}>
            <summary className={ACCORDION_SUMMARY}>
              <span>Cancellation</span>
              <FaCaretDown className={CHEVRON} aria-hidden />
            </summary>
            <div className={ACCORDION_BODY}>
              {renderEmphasised(cancellationCopy(policy.CANCELLATION))}
            </div>
          </details>

          <details className={ACCORDION_DETAILS}>
            <summary className={ACCORDION_SUMMARY}>
              <span>Unsuccessful work</span>
              <FaCaretDown className={CHEVRON} aria-hidden />
            </summary>
            <div className={ACCORDION_BODY}>
              {renderEmphasised(
                unsuccessfulWorkCopy(policy.UNSUCCESSFUL_WORK_FACTOR, policy.NO_FIX_FREE_MINS),
              )}
            </div>
          </details>

          {/* A 0-day window means no stated guarantee, so the section is hidden. */}
          {policy.WORKMANSHIP_WINDOW_DAYS > 0 && (
            <details className={ACCORDION_DETAILS}>
              <summary className={ACCORDION_SUMMARY}>
                <span>Workmanship guarantee</span>
                <FaCaretDown className={CHEVRON} aria-hidden />
              </summary>
              <div className={ACCORDION_BODY}>
                {renderEmphasised(workmanshipCopy(policy.WORKMANSHIP_WINDOW_DAYS))}
              </div>
            </details>
          )}

          <details className={ACCORDION_DETAILS}>
            <summary className={ACCORDION_SUMMARY}>
              <span>Public holidays</span>
              <FaCaretDown className={CHEVRON} aria-hidden />
            </summary>
            <div className={ACCORDION_BODY}>
              {renderEmphasised(publicHolidayCopy(policy.PUBLIC_HOLIDAY_UPLIFT))}
            </div>
          </details>

          <details className={ACCORDION_DETAILS}>
            <summary className={ACCORDION_SUMMARY}>
              <span>GST</span>
              <FaCaretDown className={CHEVRON} aria-hidden />
            </summary>
            <div className={ACCORDION_BODY}>{renderEmphasised(gstCopy(policy.GST_REGISTERED))}</div>
          </details>
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
