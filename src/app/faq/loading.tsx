// src/app/faq/loading.tsx
/**
 * @file loading.tsx
 * @description Streaming skeleton for the FAQ page: a heading card plus the
 * two-column stack of collapsed accordion rows and a next-steps card.
 */

import { CARD, FrostedSection, PageShell, SOFT_CARD } from "@/shared/components/PageLayout";
import { Bone } from "@/shared/components/Skeleton";
import { cn } from "@/shared/lib/cn";
import type React from "react";

/**
 * FAQ route-loading skeleton.
 * @returns Skeleton element.
 */
export default function FaqLoading(): React.ReactElement {
  return (
    <PageShell>
      <FrostedSection>
        <div
          className="flex flex-col gap-6 sm:gap-8"
          role="status"
          aria-live="polite"
          aria-label="Loading FAQ page"
        >
          {/* Heading card */}
          <section className={cn(CARD)}>
            <Bone className="mb-4 h-9 w-96 max-w-full sm:h-10" />
            <Bone className="h-6 w-full max-w-xl" />
          </section>

          {/* Two-column accordion rows */}
          <section className={cn(CARD)}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              {Array.from({ length: 2 }).map((_, col) => (
                <div key={col} className="flex flex-1 flex-col gap-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className={cn(SOFT_CARD, "flex items-center justify-between gap-3")}
                    >
                      <Bone className="h-5 max-w-xs flex-1" />
                      <Bone className="size-5 shrink-0 rounded-full" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          {/* Next steps */}
          <section className={cn(CARD)}>
            <Bone className="h-6 w-full max-w-md" />
          </section>

          <span className="sr-only">Loading FAQ page...</span>
        </div>
      </FrostedSection>
    </PageShell>
  );
}
