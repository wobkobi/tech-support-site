// src/app/about/page.tsx
/**
 * About page: background, approach, and who I help.
 */

import type React from "react";
import { FrostedSection, PageShell, CARD } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const linkStyle = cn(
  "text-coquelicot-500 hover:text-coquelicot-600 underline-offset-4 hover:underline",
);

/**
 * About page component.
 * @returns About page element.
 */
export default function AboutPage(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection maxWidth="56rem">
        <div className={cn("flex flex-col gap-4 sm:gap-5")}>
          <section aria-labelledby="about-hero-heading" className={cn(CARD)}>
            <h1
              id="about-hero-heading"
              className={cn(
                "text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              About To The Point Tech
            </h1>

            <p className={cn("text-rich-black mb-3 text-sm sm:text-base")}>
              I'm Harrison, a computer science graduate based in Point Chevalier. I started To The
              Point Tech because I saw how many people struggle with everyday technology problems
              but don't have anyone reliable to call.
            </p>

            <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
              My focus is on practical fixes and clear explanations. I want to leave your tech in a
              better state than I found it, and make sure you understand what changed and why.
            </p>
          </section>

          <section aria-labelledby="about-approach-heading" className={cn(CARD)}>
            <h2
              id="about-approach-heading"
              className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}
            >
              My approach
            </h2>

            <ul
              className={cn(
                "text-rich-black/90 mb-3 list-disc space-y-2 pl-5 text-sm sm:text-base",
              )}
            >
              <li>
                <strong>Listen first.</strong> I start with a quick chat to understand what's
                happening and what you want to achieve.
              </li>
              <li>
                <strong>Explain before acting.</strong> You'll know what I'm planning to do and
                roughly how long it should take before I touch anything.
              </li>
              <li>
                <strong>Work transparently.</strong> I make changes in small steps so you can see
                what's happening and ask questions.
              </li>
              <li>
                <strong>Leave clear notes.</strong> After every visit, you get a simple summary of
                what changed and any tips for next time.
              </li>
            </ul>

            <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
              I'm happy to work with you directly, alongside family members, or with a small
              business owner. If you prefer, we can start with email and move to a visit once you're
              comfortable.
            </p>
          </section>

          <section aria-labelledby="about-who-heading" className={cn(CARD)}>
            <h2
              id="about-who-heading"
              className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}
            >
              Who I help
            </h2>

            <p className={cn("text-rich-black mb-2 text-sm sm:text-base")}>
              I mainly work with households and small businesses around Point Chevalier who want
              their tech to just work, without wading through jargon or sales pitches.
            </p>

            <ul
              className={cn(
                "text-rich-black/90 mb-3 list-disc space-y-1 pl-5 text-sm sm:text-base",
              )}
            >
              <li>Home users wanting reliable Wi-Fi, secure accounts, and proper backups.</li>
              <li>Families helping parents or grandparents get comfortable with devices.</li>
              <li>
                Sole traders and small teams who need occasional IT support without a contract.
              </li>
            </ul>

            <p className={cn("text-rich-black/80 text-sm sm:text-base")}>
              See the{" "}
              <Link href="/services" className={linkStyle}>
                services page
              </Link>{" "}
              for specifics, or{" "}
              <Link href="/contact" className={linkStyle}>
                get in touch
              </Link>{" "}
              to chat about what you need.
            </p>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
