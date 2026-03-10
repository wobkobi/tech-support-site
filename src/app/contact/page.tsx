// src/app/contact/page.tsx
/**
 * @file page.tsx
 * @description Contact page: how to get in touch.
 */

import type React from "react";
import { FrostedSection, PageShell, CARD } from "@/shared/components/PageLayout";
import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/lib/cn";
import { FaEnvelope, FaPhone, FaMapLocationDot } from "react-icons/fa6";

/**
 * Contact page component.
 * @returns React element for the contact page.
 */
export default function ContactPage(): React.ReactElement {
  return (
    <PageShell>
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
                "text-russian-violet mb-4 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Get in touch
            </h1>

            <p className={cn("text-rich-black mx-auto mb-8 max-w-2xl text-sm sm:text-base")}>
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

            <p className={cn("text-rich-black/70 mx-auto mt-6 max-w-xl text-sm sm:text-base")}>
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
                  "border-moonstone-500/30 bg-moonstone-600/10 grid size-12 shrink-0 place-items-center rounded-lg border sm:size-14",
                )}
              >
                <FaMapLocationDot
                  className={cn("text-moonstone-600 h-6 w-6 sm:h-7 sm:w-7")}
                  aria-hidden
                />
              </div>
              <div>
                <h2
                  id="area-heading"
                  className={cn("text-russian-violet mb-2 text-xl font-bold sm:text-2xl")}
                >
                  Service area
                </h2>
                <p className={cn("text-rich-black mb-3 text-sm sm:text-base")}>
                  Based in Point Chevalier, serving nearby suburbs including Western Springs, Mount
                  Albert, Grey Lynn, Westmere, Kingsland, and surrounding areas.
                </p>
                <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
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
              className={cn("text-russian-violet mb-3 text-xl font-bold sm:text-2xl")}
            >
              What to include when you contact me
            </h2>

            <p className={cn("text-rich-black mb-4 text-sm sm:text-base")}>
              A few details help me give you a quick, accurate quote:
            </p>

            <ul className={cn("text-rich-black space-y-2.5 text-sm sm:text-base")}>
              <li className={cn("flex gap-3")}>
                <span className={cn("text-moonstone-600 mt-1 text-lg")}>•</span>
                <span>What's happening or what you want to achieve</span>
              </li>
              <li className={cn("flex gap-3")}>
                <span className={cn("text-moonstone-600 mt-1 text-lg")}>•</span>
                <span>Which devices are involved (e.g., laptop, phone, printer)</span>
              </li>
              <li className={cn("flex gap-3")}>
                <span className={cn("text-moonstone-600 mt-1 text-lg")}>•</span>
                <span>Whether it's for home or business</span>
              </li>
              <li className={cn("flex gap-3")}>
                <span className={cn("text-moonstone-600 mt-1 text-lg")}>•</span>
                <span>Your availability (mornings, evenings, weekends)</span>
              </li>
            </ul>

            <p className={cn("text-rich-black/80 mt-4 text-sm sm:text-base")}>
              Feel free to include screenshots or photos if they help explain the issue.
            </p>
          </section>

          {/* CTA */}
          <section
            aria-label="Ready to get started"
            className={cn(CARD, "animate-slide-up animate-fill-both animate-delay-300 text-center")}
          >
            <p className={cn("text-rich-black mb-4 text-sm sm:text-base")}>
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
