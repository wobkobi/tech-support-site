// src/app/contact/page.tsx
/**
 * Contact page: how to get in touch and what to include.
 */

import type React from "react";
import { FrostedSection, PageShell, CARD, SOFT_CARD } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";
import { FaEnvelope, FaPhone } from "react-icons/fa6";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const primaryBtn = cn(
  "bg-coquelicot-500 hover:bg-coquelicot-600 text-rich-black flex items-center gap-2 rounded-md px-4 py-2.5 font-semibold text-sm sm:text-base",
);
const secondaryBtn = cn(
  "border-seasalt-400/60 hover:bg-seasalt-900/40 text-rich-black flex items-center gap-2 rounded-md border px-4 py-2.5 font-semibold text-sm sm:text-base",
);

/**
 * Contact page component.
 * @returns React element for the contact page.
 */
export default function ContactPage(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection maxWidth="56rem">
        <div className={cn("flex flex-col gap-4 sm:gap-5")}>
          <section aria-labelledby="contact-hero-heading" className={cn(CARD)}>
            <h1
              id="contact-hero-heading"
              className={cn(
                "text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Get in touch
            </h1>

            <p className={cn("text-rich-black mb-3 text-sm sm:text-base")}>
              Send a message or give me a call with a quick description of what you need help with.
              I'll get back to you with how I can help and what the next steps would be.
            </p>

            <div className={cn("flex flex-wrap items-center gap-3")}>
              <a href="tel:+64212971237" className={primaryBtn}>
                <FaPhone className={cn("h-5 w-5")} aria-hidden />
                Call +64 21 297 1237
              </a>
              <a href="mailto:harrison@tothepoint.co.nz" className={secondaryBtn}>
                <FaEnvelope className={cn("h-5 w-5")} aria-hidden />
                Email me
              </a>
            </div>

            <p className={cn("text-rich-black/70 mt-3 text-xs sm:text-sm")}>
              If I'm with another client, I'll get back to you as soon as I can—usually the same day
              or next business day.
            </p>
          </section>

          <section aria-labelledby="contact-channels-heading" className={cn(CARD)}>
            <h2
              id="contact-channels-heading"
              className={cn("text-rich-black mb-3 text-lg font-semibold sm:text-xl")}
            >
              Best ways to reach me
            </h2>

            <div className={cn("grid gap-4 sm:grid-cols-2")}>
              <a
                href="tel:+64212971237"
                className={cn(SOFT_CARD, "hover:border-coquelicot-500/70 transition-colors")}
              >
                <div className={cn("flex items-start gap-3")}>
                  <span
                    className={cn(
                      "border-moonstone-500/30 bg-moonstone-600/15 grid size-10 shrink-0 place-items-center rounded-md border",
                    )}
                  >
                    <FaPhone className={cn("text-moonstone-600 h-5 w-5")} aria-hidden />
                  </span>
                  <div>
                    <p className={cn("text-russian-violet text-sm font-semibold")}>Phone</p>
                    <p className={cn("text-rich-black font-semibold")}>+64 21 297 1237</p>
                    <p className={cn("text-rich-black/80 mt-1 text-xs sm:text-sm")}>
                      Best for urgent issues or if you prefer to talk things through.
                    </p>
                  </div>
                </div>
              </a>

              <a
                href="mailto:harrison@tothepoint.co.nz"
                className={cn(SOFT_CARD, "hover:border-coquelicot-500/70 transition-colors")}
              >
                <div className={cn("flex items-start gap-3")}>
                  <span
                    className={cn(
                      "border-moonstone-500/30 bg-moonstone-600/15 grid size-10 shrink-0 place-items-center rounded-md border",
                    )}
                  >
                    <FaEnvelope className={cn("text-moonstone-600 h-5 w-5")} aria-hidden />
                  </span>
                  <div>
                    <p className={cn("text-russian-violet text-sm font-semibold")}>Email</p>
                    <p className={cn("text-rich-black font-semibold")}>harrison@tothepoint.co.nz</p>
                    <p className={cn("text-rich-black/80 mt-1 text-xs sm:text-sm")}>
                      Great for detailed descriptions, screenshots, or a list of questions.
                    </p>
                  </div>
                </div>
              </a>
            </div>
          </section>

          <section aria-labelledby="contact-details-heading" className={cn(CARD)}>
            <h2
              id="contact-details-heading"
              className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}
            >
              What to include
            </h2>

            <p className={cn("text-rich-black mb-3 text-sm sm:text-base")}>
              A few details help me understand the situation and give you an accurate idea of time
              and cost:
            </p>

            <ul className={cn("text-rich-black/90 list-disc space-y-2 pl-5 text-sm sm:text-base")}>
              <li>What's happening or what you'd like to achieve</li>
              <li>Which devices are involved (e.g., Windows laptop, iPhone, smart TV)</li>
              <li>Whether it's for home or a small business</li>
              <li>Your general availability (weekday mornings, evenings, etc.)</li>
              <li>Any deadlines (e.g., "need this sorted before a trip next week")</li>
            </ul>

            <p className={cn("text-rich-black/80 mt-3 text-sm sm:text-base")}>
              Screenshots or photos are welcome if they help explain an error or setup.
            </p>
          </section>

          <section aria-labelledby="contact-areas-heading" className={cn(CARD)}>
            <h2
              id="contact-areas-heading"
              className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}
            >
              Service area
            </h2>

            <p className={cn("text-rich-black mb-2 text-sm sm:text-base")}>
              I'm based in Point Chevalier and travel to nearby suburbs including Western Springs,
              Mount Albert, Grey Lynn, Westmere, Kingsland, and surrounding areas.
            </p>

            <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
              Remote support is available for many software and account tasks if you have a stable
              internet connection. Not sure if your job needs an on-site visit? Just ask.
            </p>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
