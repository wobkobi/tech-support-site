// src/app/contact/page.tsx
/**
 * @file page.tsx
 * @description Contact page: how to get in touch.
 */

import { BreadcrumbJsonLd } from "@/shared/components/BreadcrumbJsonLd";
import { Button } from "@/shared/components/Button";
import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { cn } from "@/shared/lib/cn";
import type { Metadata } from "next";
import type React from "react";
import { FaEnvelope, FaMapLocationDot, FaPhone } from "react-icons/fa6";

export const metadata: Metadata = {
  title: "Contact - Local Tech Support in Auckland",
  description:
    "Call 021 297 1237 or email harrison@tothepoint.co.nz for friendly tech support across Auckland. Same-day, evening and weekend appointments available.",
  alternates: { canonical: "/contact" },
  openGraph: {
    title: "Contact - To The Point Tech",
    description: "Reach out by phone or email for tech help across Auckland.",
    url: "/contact",
  },
};

/**
 * Contact page component.
 * @returns React element for the contact page.
 */
export default function ContactPage(): React.ReactElement {
  return (
    <PageShell>
      <BreadcrumbJsonLd
        crumbs={[
          { name: "Home", path: "/" },
          { name: "Contact", path: "/contact" },
        ]}
      />
      <FrostedSection>
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          {/* Hero Section */}
          <section
            aria-labelledby="contact-heading"
            className={cn(CARD, "animate-fade-in text-center")}
          >
            <h1
              id="contact-heading"
              className={cn(
                "mb-4 text-2xl font-extrabold text-russian-violet sm:text-3xl md:text-4xl",
              )}
            >
              Get in touch
            </h1>

            <p className={cn("mx-auto mb-8 max-w-2xl text-base text-rich-black sm:text-lg")}>
              Have a tech problem or question? Call or email and I'll help you figure it out.
            </p>

            <div className={cn("flex flex-col items-center gap-4 sm:flex-row sm:justify-center")}>
              <Button
                href="tel:+64212971237"
                variant="secondary"
                size="lg"
                className={cn("w-full sm:w-auto")}
              >
                <FaPhone className={cn("h-6 w-6")} aria-hidden />
                021 297 1237
              </Button>
              <Button
                href="mailto:harrison@tothepoint.co.nz"
                variant="tertiary"
                size="lg"
                className={cn("w-full sm:w-auto")}
              >
                <FaEnvelope className={cn("h-6 w-6")} aria-hidden />
                Email me
              </Button>
            </div>

            <p className={cn("mx-auto mt-6 max-w-xl text-base text-rich-black/70 sm:text-lg")}>
              I usually respond within a few hours during business days.
            </p>
          </section>

          {/* Service Area */}
          <section
            aria-labelledby="area-heading"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-100")}
          >
            <div className={cn("flex items-start gap-4")}>
              <div
                className={cn(
                  "grid size-12 shrink-0 place-items-center rounded-lg border border-moonstone-500/30 bg-moonstone-600/10 sm:size-14",
                )}
              >
                <FaMapLocationDot
                  className={cn("h-6 w-6 text-moonstone-600 sm:h-7 sm:w-7")}
                  aria-hidden
                />
              </div>
              <div>
                <h2
                  id="area-heading"
                  className={cn("mb-2 text-xl font-bold text-russian-violet sm:text-2xl")}
                >
                  Service area
                </h2>
                <p className={cn("mb-3 text-base text-rich-black sm:text-lg")}>
                  On-site visits across Auckland.
                </p>
                <p className={cn("text-base text-rich-black/80 sm:text-lg")}>
                  Remote support available for software and account issues. No travel needed.
                </p>
              </div>
            </div>
          </section>

          {/* What to Include */}
          <section
            aria-labelledby="details-heading"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-200")}
          >
            <h2
              id="details-heading"
              className={cn("mb-3 text-xl font-bold text-russian-violet sm:text-2xl")}
            >
              What to include when you contact me
            </h2>

            <p className={cn("mb-4 text-base text-rich-black sm:text-lg")}>
              A few details help me give you a quick, accurate quote:
            </p>

            <ul className={cn("space-y-2.5 text-base text-rich-black sm:text-lg")}>
              <li className={cn("flex gap-3")}>
                <span className={cn("mt-1 text-lg text-moonstone-600")}>•</span>
                <span>What's happening or what you want to achieve</span>
              </li>
              <li className={cn("flex gap-3")}>
                <span className={cn("mt-1 text-lg text-moonstone-600")}>•</span>
                <span>Which devices are involved (e.g., laptop, phone, printer)</span>
              </li>
              <li className={cn("flex gap-3")}>
                <span className={cn("mt-1 text-lg text-moonstone-600")}>•</span>
                <span>Whether it's for home or business</span>
              </li>
              <li className={cn("flex gap-3")}>
                <span className={cn("mt-1 text-lg text-moonstone-600")}>•</span>
                <span>Your availability (mornings, evenings, weekends)</span>
              </li>
            </ul>

            <p className={cn("mt-4 text-base text-rich-black/80 sm:text-lg")}>
              Feel free to include screenshots or photos if they help explain the issue.
            </p>
          </section>

          {/* CTA */}
          <section
            aria-label="Ready to get started"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-300 text-center")}
          >
            <p className={cn("mb-4 text-base text-rich-black sm:text-lg")}>
              Prefer to book directly?
            </p>
            <Button href="/booking" variant="primary" size="md">
              Book an appointment
            </Button>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
