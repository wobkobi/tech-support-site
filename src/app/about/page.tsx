// src/app/about/page.tsx
/**
 * About page: background, how I work, and who I help.
 */

import type React from "react";
import { FrostedSection, PageShell } from "@/components/SiteFrame";
import { cn } from "@/lib/cn";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const pageMain = cn(
  "mx-auto flex w-full max-w-6xl flex-col gap-6 sm:gap-8",
  "pb-6 pt-4 sm:pb-8 sm:pt-6",
);

const card = cn("border-seasalt-400/60 bg-seasalt-800 rounded-xl border p-4 shadow-sm sm:p-6");
const linkStyle = cn("text-coquelicot-500 hover:text-coquelicot-600 underline-offset-4 hover:underline");

/**
 * About page component.
 * @returns About page element.
 */
export default function AboutPage(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <main className={pageMain}>
          <section aria-labelledby="about-hero-heading" className={card}>
            <h1
              id="about-hero-heading"
              className={cn("text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl md:text-4xl")}
            >
              About To The Point Tech
            </h1>

            <p className={cn("text-rich-black mb-3 max-w-3xl text-sm sm:text-base")}>
              I am Harrison, a computer science graduate based in Point Chevalier. I started To The
              Point Tech so locals have a reliable, friendly person to call when technology acts up,
              without needing a big corporate IT provider.
            </p>

            <p className={cn("text-rich-black/80 max-w-3xl text-sm sm:text-base")}>
              The focus is on practical fixes and simple upgrades that make everyday life easier:
              steadier Wi-Fi, safer accounts, organised photos, and devices that feel less
              frustrating to use.
            </p>
          </section>

          <section aria-labelledby="about-how-heading" className={card}>
            <h2 id="about-how-heading" className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}>
              How I work
            </h2>

            <ul className={cn("text-rich-black/90 mb-3 list-disc space-y-2 pl-5 text-sm sm:text-base")}>
              <li>Start with a short chat about what is going wrong or what you want to improve.</li>
              <li>Agree on a rough plan and time before changing anything on your devices.</li>
              <li>Make changes in small, understandable steps so you can see what is happening.</li>
              <li>Leave things in a tidier, more predictable state than when I arrived.</li>
            </ul>

            <p className={cn("text-rich-black/80 max-w-3xl text-sm sm:text-base")}>
              I am happy to work directly with you, alongside family, or with a small business owner
              or manager. If you prefer, we can start with email and move to a visit or remote
              session once you are comfortable.
            </p>
          </section>

          <section aria-labelledby="about-who-heading" className={card}>
            <h2 id="about-who-heading" className={cn("text-rich-black mb-2 text-lg font-semibold sm:text-xl")}>
              Who I help
            </h2>

            <p className={cn("text-rich-black mb-2 max-w-3xl text-sm sm:text-base")}>
              I mainly work with households and small businesses in and around Point Chevalier who
              want things to just work without wading through jargon or sales pitches.
            </p>

            <ul className={cn("text-rich-black/90 mb-3 list-disc space-y-1 pl-5 text-sm sm:text-base")}>
              <li>Home users wanting reliable Wi-Fi, backups, and safer accounts.</li>
              <li>Families helping parents or grandparents with devices and logins.</li>
              <li>Sole traders and small teams who need light ongoing support.</li>
            </ul>

            <p className={cn("text-rich-black/80 max-w-3xl text-sm sm:text-base")}>
              To see specific things I can help with, visit the{" "}
              <Link href="/services" className={linkStyle}>
                services page
              </Link>{" "}
              or head to the{" "}
              <Link href="/contact" className={linkStyle}>
                contact page
              </Link>{" "}
              to get in touch.
            </p>
          </section>
        </main>
      </FrostedSection>
    </PageShell>
  );
}
