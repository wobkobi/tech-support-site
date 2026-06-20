// src/app/loading.tsx
/**
 * @file loading.tsx
 * @description Streaming skeleton for the home page: hero, trust cards,
 * support grid, about/approach pair and flyer card. Matches the real page
 * layout so the swap causes no layout shift once the approved-reviews query
 * resolves.
 */

import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { Bone } from "@/shared/components/Skeleton";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Home route-loading skeleton.
 * @returns Skeleton element.
 */
export default function HomeLoading(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <div
          className="flex flex-col gap-6 sm:gap-8"
          role="status"
          aria-live="polite"
          aria-label="Loading home page"
        >
          {/* Hero */}
          <section className="flex flex-col items-center text-center">
            <Bone className="mb-6 h-24 w-70 sm:h-28 sm:w-95 md:w-120 lg:w-140" />
            <Bone className="mb-4 h-9 w-full max-w-3xl sm:h-10" />
            <Bone className="mb-8 h-6 w-full max-w-2xl" />
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Bone className="h-12 w-44 rounded-xl" />
              <Bone className="h-12 w-40 rounded-xl" />
            </div>
            <Bone className="mt-6 h-5 w-80 max-w-full" />
          </section>

          {/* Trust indicators */}
          <section className="grid gap-4 sm:grid-cols-3 sm:gap-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={cn(CARD, "flex flex-col items-center text-center")}>
                <Bone className="mb-3 size-16 rounded-full" />
                <Bone className="mb-2 h-7 w-44" />
                <Bone className="h-5 w-52 max-w-full" />
              </div>
            ))}
          </section>

          {/* Services grid */}
          <section className="flex flex-col items-center">
            <Bone className="mb-8 h-9 w-72 sm:h-10" />
            <ul className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 rounded-xl border border-seasalt-400/60 bg-seasalt-800 p-3 shadow-sm"
                >
                  <Bone className="size-12 shrink-0 rounded-lg sm:size-14" />
                  <Bone className="h-5 flex-1" />
                </li>
              ))}
            </ul>
            <Bone className="mt-8 h-10 w-40 rounded-xl" />
          </section>

          {/* About & approach */}
          <section className="grid gap-5 md:grid-cols-2 md:gap-6">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className={cn(CARD)}>
                <Bone className="mb-4 h-8 w-40" />
                <Bone className="mb-2 h-5 w-full" />
                <Bone className="mb-2 h-5 w-full" />
                <Bone className="h-5 w-2/3" />
              </div>
            ))}
          </section>

          {/* Flyer */}
          <section className={cn(CARD)}>
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <Bone className="size-16 shrink-0 rounded-full" />
              <div className="flex-1 text-center sm:text-left">
                <Bone className="mb-2 h-6 w-72 max-w-full" />
                <Bone className="h-5 w-full max-w-md" />
              </div>
              <Bone className="h-10 w-36 shrink-0 rounded-xl" />
            </div>
          </section>

          <span className="sr-only">Loading home page...</span>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
