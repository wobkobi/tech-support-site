// src/app/areas/page.tsx
// Service-area page: every region with its suburbs, a few common-suburb travel figures, and
// a check for what travel costs to the visitor's own suburb.

import { TravelCheck } from "@/features/areas/components/TravelCheck";
import { getSuburbTravel } from "@/features/areas/lib/area-travel.server";
import { commonSuburbs, regionSlug, travelFigure } from "@/features/areas/lib/areas";
import { formatMoneyCompact } from "@/features/business/lib/business-format";
import { travelCopy } from "@/features/business/lib/pricing-policy";
import { getPolicy, getPublicPricing } from "@/features/business/lib/pricing-policy.server";
import {
  getActivePromo,
  promoDisplayRate,
  promoForRateCard,
  promoTravelFactor,
} from "@/features/business/lib/promos";
import { ClosingCta } from "@/shared/components/ClosingCta";
import { PageHead } from "@/shared/components/PageHead";
import { PageShell } from "@/shared/components/PageLayout";
import { PromoPrice } from "@/shared/components/PromoPrice";
import { RuledBlock, RuledGrid } from "@/shared/components/RuledGrid";
import { Section, SectionHeading } from "@/shared/components/Section";
import { renderEmphasised } from "@/shared/components/renderEmphasised";
import { roundCents } from "@/shared/lib/money";
import { pageOpenGraph } from "@/shared/lib/open-graph";
import { servedSuburbGroups } from "@/shared/lib/served-suburbs";
import { getSettings } from "@/shared/lib/settings/get-settings";
import type { Metadata } from "next";
import type React from "react";

// ISR like /pricing, so rate and suburb edits reach the page without a redeploy.
export const revalidate = 86400;

const TITLE = "Computer Help Across Auckland - Areas and Travel Costs";
const DESCRIPTION =
  "Computer and IT help across Auckland: Central, West, North Shore, East and South. No call-out fee - check what travel costs to your suburb.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/areas" },
  openGraph: pageOpenGraph({ title: TITLE, description: DESCRIPTION, url: "/areas" }),
};

/**
 * Areas page with live rates, the gated promo, and cached common-suburb drive times.
 * @returns Areas page element.
 */
export default async function AreasPage(): Promise<React.ReactElement> {
  const [promo, pricing, policy, { identity, scheduling }] = await Promise.all([
    getActivePromo(),
    getPublicPricing(),
    getPolicy(),
    getSettings(),
  ]);
  // Figures go through the rate-card gate, the same as /pricing, so the two never disagree.
  const pricedPromo = promoForRateCard(promo);
  const displayRate = promoDisplayRate(pricing.baseRate, pricedPromo);
  const travelFactor = promoTravelFactor(pricedPromo);
  const displayTravelRate = roundCents(pricing.travelRatePerHour * travelFactor);
  const displayMinTravel = roundCents(policy.MIN_TRAVEL_CHARGE * travelFactor);

  // Common-suburb figures: cached drive times priced with the live rate. A suburb whose
  // lookup failed simply shows no figure.
  const regions = await Promise.all(
    servedSuburbGroups(identity).map(async (group) => {
      const figures = await Promise.all(
        commonSuburbs(group).map(async (suburb) => {
          const drive = await getSuburbTravel(suburb, scheduling.travelQuoteHour);
          const figure = drive
            ? travelFigure(
                drive.thereMins,
                drive.backMins,
                pricing.travelRatePerHour,
                policy.MIN_TRAVEL_CHARGE,
                travelFactor,
              )
            : null;
          return figure ? { suburb, figure } : null;
        }),
      );
      return {
        id: regionSlug(group.region),
        name: group.region ?? "Other areas",
        suburbs: group.suburbs,
        figures: figures.filter((f) => f !== null),
      };
    }),
  );

  return (
    <PageShell>
      <PageHead
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Areas", path: "/areas" },
        ]}
        title="Computer help across Auckland"
        intro={
          <p>
            I come to homes and businesses right across Auckland, fix the problem, explain what went
            wrong in plain English, and don&apos;t leave until it actually works.
          </p>
        }
        note={<p>Put your suburb in below to see what travel costs before you book.</p>}
      />

      <Section aria-labelledby="why-heading">
        <SectionHeading title="Why people book me" id="why-heading" />
        <RuledGrid cols={3}>
          <RuledBlock
            title={
              <>
                <PromoPrice discounted={displayRate !== pricing.baseRate}>
                  {formatMoneyCompact(displayRate)}/hr
                </PromoPrice>
                , no call-out fee
              </>
            }
          >
            <p>
              You pay for the time I work and one trip. There&apos;s no charge just for turning up.
            </p>
          </RuledBlock>
          <RuledBlock title="Fixed before I leave">
            <p>
              I keep going until it actually works, and I&apos;ll tell you straight if something
              can&apos;t be fixed.
            </p>
          </RuledBlock>
          <RuledBlock title="Plain English">
            <p>You&apos;ll know what went wrong, what I did, and how to avoid it next time.</p>
          </RuledBlock>
        </RuledGrid>
      </Section>

      <Section tone="grey" id="travel" aria-labelledby="travel-heading">
        <SectionHeading
          title="What travel costs to you"
          id="travel-heading"
          lead="Type your suburb or address and I'll show you the drive time and the travel charge."
        />
        <TravelCheck
          travelRatePerHour={pricing.travelRatePerHour}
          minTravelCharge={policy.MIN_TRAVEL_CHARGE}
          travelFactor={travelFactor}
          phone={identity.phone}
          phoneTel={identity.phoneTel}
        />
        <div className="mt-6 max-w-180 whitespace-pre-line">
          <p>{renderEmphasised(travelCopy(displayTravelRate, displayMinTravel))}</p>
          <p className="mt-3">
            A lot of software and account problems I can sort out remotely, with no travel at all.
          </p>
        </div>
      </Section>

      <Section aria-labelledby="regions-heading">
        <SectionHeading
          title="Where I go"
          id="regions-heading"
          lead="Each area with a few of its suburbs and what travel usually costs on a weekday."
        />
        <RuledGrid cols={2}>
          {regions.map((region) => (
            <RuledBlock key={region.id} id={region.id} title={region.name}>
              {region.figures.length > 0 && (
                <ul className="mb-3 grid gap-1">
                  {region.figures.map(({ suburb, figure }) => (
                    <li key={suburb}>
                      <span className="font-bold">{suburb}</span>: about {figure.eachWayMins} min
                      each way, about{" "}
                      <PromoPrice discounted={figure.charged < figure.full}>
                        {formatMoneyCompact(figure.charged)}
                      </PromoPrice>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-seasalt-700">{region.suburbs.join(", ")}</p>
            </RuledBlock>
          ))}
        </RuledGrid>
        <p className="mt-8">
          Not listed? I cover all of Auckland, so check your suburb above or just ask.
        </p>
      </Section>

      <ClosingCta
        title="Ready to book?"
        line="Pick a time online in a couple of minutes."
        phone={identity.phone}
        phoneTel={identity.phoneTel}
      />
    </PageShell>
  );
}
