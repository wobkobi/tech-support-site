// src/app/not-found.tsx
/**
 * @file not-found.tsx
 * @description Themed 404 page. Matches site styling.
 */

import type React from "react";
import { FrostedSection, PageShell, CARD } from "@/components/PageLayout";
import { cn } from "@/lib/cn";
import Link from "next/link";
import { FaHouse } from "react-icons/fa6";

/**
 * 404 UI for missing routes.
 * @returns Not Found page element.
 */
export default function NotFound(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection maxWidth="48rem">
        <div className={cn("flex flex-col gap-6 sm:gap-8")}>
          <section className={cn(CARD, "text-center")}>
            <div className={cn("text-coquelicot-500 mb-4 text-8xl font-extrabold sm:text-9xl")}>
              404
            </div>

            <h1
              className={cn(
                "text-russian-violet mb-4 text-3xl font-extrabold sm:text-4xl md:text-5xl",
              )}
            >
              Well, this is awkward...
            </h1>

            <p className={cn("text-rich-black mb-2 text-base sm:text-lg md:text-xl")}>
              This page seems to have wandered off like a Wi-Fi signal at the worst possible moment.
            </p>

            <p className={cn("text-rich-black/80 mb-6 text-base sm:text-lg")}>
              Don't worry. I'm better at finding solutions than this page is at hiding.
            </p>

            <div className={cn("flex flex-wrap items-center justify-center gap-3")}>
              <Link
                href="/"
                className={cn(
                  "bg-coquelicot-500 hover:bg-coquelicot-600 text-seasalt inline-flex items-center gap-2 rounded-lg px-6 py-3 font-semibold shadow-lg transition-colors hover:shadow-xl",
                )}
              >
                <FaHouse className={cn("h-5 w-5")} aria-hidden />
                Take me home
              </Link>

              <Link
                href="/contact"
                className={cn(
                  "border-seasalt-400/60 hover:bg-seasalt-900/40 text-rich-black inline-flex items-center gap-2 rounded-lg border px-6 py-3 font-semibold transition-colors",
                )}
              >
                Report this issue
              </Link>
            </div>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
