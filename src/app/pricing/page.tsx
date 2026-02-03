// src/app/pricing/page.tsx
/**
 * Pricing page.
 */

import type React from "react";
import Link from "next/link";
import { FrostedSection, PageShell } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const pageMain = cn(
  "mx-auto flex w-full max-w-6xl flex-col gap-6 sm:gap-8",
  "pt-4 sm:pt-6 pb-6 sm:pb-8",
);

const card = cn("border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm sm:p-6");
const softCard = cn(
  "border-seasalt-400/60 bg-seasalt-900/60 rounded-xl border p-3 shadow-sm sm:p-4",
);
const linkStyle = cn(
  "text-coquelicot-500 hover:text-coquelicot-600 underline-offset-4 hover:underline",
);

/**
 *
 */
export default function PricingPage(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <main className={pageMain}>
          <section aria-labelledby="pricing-heading" className={card}>
            <h1
              id="pricing-heading"
              className={cn(
                "text-russian-violet mb-2 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Pricing
            </h1>
            <p className={cn("text-rich-black/80 max-w-3xl text-sm sm:text-base")}>
              Pricing is straightforward: most work is billed hourly with a minimum call-out for
              on-site visits. You will get clarity on cost and scope before anything starts.
            </p>
          </section>

          <section aria-label="How billing works" className={card}>
            <div className={cn("grid gap-3 sm:grid-cols-2 sm:gap-4")}>
              <div className={softCard}>
                <h2 className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}>
                  On-site visits
                </h2>
                <ul
                  className={cn("text-rich-black/90 list-disc space-y-2 pl-5 text-sm sm:text-base")}
                >
                  <li>Typically billed hourly with a minimum call-out.</li>
                  <li>
                    Best for Wi-Fi issues, printers, smart TVs, and anything physical or
                    cabling-related.
                  </li>
                  <li>If you have multiple small issues, we can bundle them into one visit.</li>
                </ul>
              </div>

              <div className={softCard}>
                <h2 className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}>
                  Remote help
                </h2>
                <ul
                  className={cn("text-rich-black/90 list-disc space-y-2 pl-5 text-sm sm:text-base")}
                >
                  <li>Great for account issues, software setup, and follow-up tweaks.</li>
                  <li>Often shorter sessions for quick fixes.</li>
                  <li>Requires a stable internet connection and access to the device.</li>
                </ul>
              </div>
            </div>
          </section>

          <section aria-label="Estimates and bigger jobs" className={card}>
            <h2 className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}>
              Estimates and bigger jobs
            </h2>
            <p className={cn("text-rich-black mb-3 max-w-3xl text-sm sm:text-base")}>
              For larger jobs (new device migrations, small business tidy-ups, multi-room Wi-Fi
              changes), I can break the work into stages so you can decide how far to go.
            </p>
            <p className={cn("text-rich-black/80 max-w-3xl text-sm sm:text-base")}>
              The easiest way to get an accurate estimate is to{" "}
              <Link href="/contact" className={linkStyle}>
                send a quick message
              </Link>{" "}
              with what you want to achieve and what devices are involved.
            </p>
          </section>

          <section aria-label="Next steps" className={card}>
            <p className={cn("text-rich-black text-sm sm:text-base")}>
              Next:{" "}
              <Link href="/services" className={linkStyle}>
                view services
              </Link>{" "}
              or{" "}
              <Link href="/booking" className={linkStyle}>
                book a time
              </Link>
              .
            </p>
          </section>
        </main>
      </FrostedSection>
    </PageShell>
  );
}
