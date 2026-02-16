// src/app/not-found.tsx
/**
 * @file not-found.tsx
 * @description Themed 404 page. Matches site styling.
 */

import type React from "react";
import { FrostedSection, PageShell, CARD } from "@/components/SiteFrame";
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
        <div className={cn("flex flex-col gap-4 sm:gap-5")}>
          <section className={cn(CARD)}>
            <h1
              className={cn(
                "text-russian-violet mb-3 text-2xl font-extrabold sm:text-3xl md:text-4xl",
              )}
            >
              Page not found
            </h1>

            <p className={cn("text-rich-black mb-4 text-sm sm:text-base")}>
              The page you're looking for doesn't exist or has been moved.
            </p>

            <Link
              href="/"
              className={cn(
                "bg-russian-violet text-seasalt inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold",
                "hover:brightness-110",
              )}
            >
              <FaHouse className={cn("h-4 w-4")} aria-hidden />
              Go home
            </Link>
          </section>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
