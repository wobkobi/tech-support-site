// src/app/business/loading.tsx
/**
 * @description Streaming skeleton for the business page: centred hero with CTA
 * buttons, service grid, rates list, retainer tier cards, how-it-works row,
 * FAQ block and the enquiry card.
 */

import { CARD, FrostedSection, PageShell } from "@/shared/components/PageLayout";
import { Bone } from "@/shared/components/Skeleton";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * Business route-loading skeleton.
 * @returns Skeleton element.
 */
export default function BusinessLoading(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <div
          className="flex flex-col gap-6 sm:gap-8"
          role="status"
          aria-live="polite"
          aria-label="Loading business page"
        >
          {/* Hero: heading, two paragraphs, two CTA buttons */}
          <section className={cn(CARD, "flex flex-col items-center text-center")}>
            <Bone className="mb-4 h-9 w-80 max-w-full sm:h-10" />
            <Bone className="mb-2 h-5 w-full max-w-2xl" />
            <Bone className="mb-8 h-5 w-full max-w-xl" />
            <div className="flex w-full flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Bone className="h-12 w-full rounded-xl sm:w-48" />
              <Bone className="h-12 w-full rounded-xl sm:w-48" />
            </div>
          </section>

          {/* Services grid */}
          <section className={cn(CARD)}>
            <Bone className="mb-4 h-7 w-72 max-w-full" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Bone key={i} className="h-36 rounded-lg" />
              ))}
            </div>
          </section>

          {/* Rates */}
          <section className={cn(CARD)}>
            <Bone className="mb-3 h-7 w-48" />
            <Bone className="mb-3 h-5 w-full max-w-lg" />
            <div className="flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Bone key={i} className="h-5 w-full max-w-md" />
              ))}
            </div>
          </section>

          {/* Retainer tiers */}
          <section className={cn(CARD)}>
            <Bone className="mb-4 h-7 w-56" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Bone key={i} className="h-56 rounded-lg" />
              ))}
            </div>
          </section>

          {/* How it works + FAQ + enquiry */}
          <section className={cn(CARD)}>
            <Bone className="mb-4 h-7 w-44" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Bone key={i} className="h-24 rounded-lg" />
              ))}
            </div>
          </section>
          <section className={cn(CARD)}>
            <Bone className="mb-4 h-7 w-56" />
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Bone key={i} className="h-12 w-full" />
              ))}
            </div>
          </section>

          <span className="sr-only">Loading business page...</span>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
