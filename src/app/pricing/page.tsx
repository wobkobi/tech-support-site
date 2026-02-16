// src/app/pricing/page.tsx
/**
 * Pricing page: transparent pricing structure for tech support services.
 */

import type React from "react";
import Link from "next/link";
import { FrostedSection, PageShell, CARD, SOFT_CARD } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const linkStyle = cn(
  "text-coquelicot-500 hover:text-coquelicot-600 underline-offset-4 hover:underline",
);

/**
 * Pricing page component.
 * @returns Pricing page element.
 */
export default function PricingPage(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection maxWidth="56rem">
        <div className={cn("flex flex-col gap-4 sm:gap-5")}>
          <section aria-labelledby="pricing-heading" className={cn(CARD)}>
            <h1
              id="pricing-heading"
              className={cn(
                "text-russian-violet mb-2 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Pricing
            </h1>
            <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
              Simple, transparent pricing. You'll always know the cost before work begins, and
              there's no pressure to buy anything you don't need.
            </p>
          </section>

          <section aria-label="How pricing works" className={cn(CARD)}>
            <h2 className={cn("text-rich-black mb-3 text-lg font-semibold sm:text-xl")}>
              How it works
            </h2>

            <div className={cn("grid gap-4 sm:grid-cols-2")}>
              <div className={cn(SOFT_CARD)}>
                <h3 className={cn("text-russian-violet mb-2 text-base font-semibold sm:text-lg")}>
                  On-site visits
                </h3>
                <ul
                  className={cn("text-rich-black/90 list-disc space-y-2 pl-5 text-sm sm:text-base")}
                >
                  <li>Hourly rate with a minimum call-out</li>
                  <li>Most common jobs take 1–2 hours</li>
                  <li>Multiple issues can be bundled into one visit</li>
                  <li>
                    Best for: Wi-Fi setup, printers, smart TVs, physical hardware, anything needing
                    hands-on work
                  </li>
                </ul>
              </div>

              <div className={cn(SOFT_CARD)}>
                <h3 className={cn("text-russian-violet mb-2 text-base font-semibold sm:text-lg")}>
                  Remote support
                </h3>
                <ul
                  className={cn("text-rich-black/90 list-disc space-y-2 pl-5 text-sm sm:text-base")}
                >
                  <li>Hourly rate, often shorter sessions</li>
                  <li>No travel time means quicker turnaround</li>
                  <li>Requires stable internet and device access</li>
                  <li>
                    Best for: account issues, software setup, email problems, quick fixes, follow-up
                    support
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section aria-labelledby="estimate-heading" className={cn(CARD)}>
            <h2
              id="estimate-heading"
              className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}
            >
              Getting an estimate
            </h2>

            <p className={cn("text-rich-black mb-3 text-sm sm:text-base")}>
              When you get in touch, I'll ask a few questions about what's happening and give you:
            </p>

            <ul
              className={cn(
                "text-rich-black/90 mb-3 list-disc space-y-1 pl-5 text-sm sm:text-base",
              )}
            >
              <li>A rough time estimate for the work</li>
              <li>Whether it needs an on-site visit or can be done remotely</li>
              <li>The likely cost range before we book anything</li>
            </ul>

            <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
              For larger jobs (device migrations, small business setups, whole-home Wi-Fi
              improvements), I can break the work into stages so you can decide how far to go.
            </p>
          </section>

          <section aria-labelledby="no-surprises-heading" className={cn(CARD)}>
            <h2
              id="no-surprises-heading"
              className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}
            >
              No surprises
            </h2>

            <ul className={cn("text-rich-black/90 list-disc space-y-2 pl-5 text-sm sm:text-base")}>
              <li>
                <strong>No hidden fees.</strong> The price I quote is the price you pay.
              </li>
              <li>
                <strong>No upselling.</strong> I don't sell hardware or earn commission on products.
              </li>
              <li>
                <strong>No charge for unsuccessful work.</strong> If I can't fix it, you don't pay
                for that time.
              </li>
              <li>
                <strong>Clear communication.</strong> If a job is taking longer than expected, I'll
                let you know before continuing.
              </li>
            </ul>
          </section>

          <section aria-label="Next steps" className={cn(CARD)}>
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
        </div>
      </FrostedSection>
    </PageShell>
  );
}
