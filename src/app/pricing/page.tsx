// src/app/pricing/page.tsx
/**
 * @file page.tsx
 * @description Pricing page: transparent pricing structure for tech support services.
 */

import type React from "react";
import Link from "next/link";
import { FrostedSection, PageShell, CARD, SOFT_CARD } from "@/components/PageLayout";
import { cn } from "@/lib/cn";

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
            aria-label="Standard rates"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}
          >
            <h2 className={cn("text-russian-violet mb-3 text-xl font-bold sm:text-2xl")}>
              Standard rate
            </h2>

            <div className={cn("bg-seasalt-900/40 border-seasalt-400/60 rounded-lg border p-5")}>
              <p className={cn("text-russian-violet mb-2 text-3xl font-bold sm:text-4xl")}>
                $50 per hour
              </p>
              <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
                Billed fairly for the time I work. On-site visits and most remote support - remote
                rates may vary.
              </p>
            </div>

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
                  <strong>Bundle multiple issues into one visit</strong> to make the most of your
                  time.
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
                  <strong>Half off for unsuccessful work.</strong> If I can't fix it, you don't pay
                  for the full amount.
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
        </div>
      </FrostedSection>
    </PageShell>
  );
}
