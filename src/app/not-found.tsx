// src/app/not-found.tsx
/**
 * @file not-found.tsx
 * @description Themed 404 page. Matches site styling.
 */

import type React from "react";
import { FrostedSection, PageShell, CARD } from "@/shared/components/PageLayout";
import { Button } from "@/shared/components/Button";
import { cn } from "@/shared/lib/cn";
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
              <Button href="/" variant="primary">
                <FaHouse className={cn("h-5 w-5")} aria-hidden />
                Take me home
              </Button>
              <Button href="/contact" variant="ghost">
                Report this issue
              </Button>
            </div>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
